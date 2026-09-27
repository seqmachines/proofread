"""Run-scoped M3 tools. Executors choose transport; these tools own mutations."""

import json
from uuid import uuid4

from pydantic import ValidationError

from db import get_db
from engine import checkpoint, emit
from evidence import list_sources, read_page, search_evidence
from cdna.molecule import MoleculeState
from cdna.skills import OPERATIONS
from cdna.tools import INPUT_NAMES, call_skill
from tool_models import ARGUMENTS
from segments import bottom_is_5to3

MAX_STEPS = 200


def downstream(workflow: dict, state_id: str) -> set[str]:
    reached, pending = set(), [state_id]
    while pending:
        current = pending.pop()
        for edge in workflow["transitions"]:
            if edge["from"] == current:
                for target in [edge["to"], *edge.get("discarded", [])]:
                    if target not in reached:
                        reached.add(target)
                        pending.append(target)
    return reached


class AgentTools:
    def __init__(self, run_id: str, harness: dict):
        self.run_id, self.harness = run_id, harness
        self.db = get_db()
        self.finished = False

    def workflow(self):
        return self.db.workflows.find_one({"run_id": self.run_id}, {"_id": 0})

    def skill_event(self, call_id):
        if not call_id:
            return None
        return self.db.events.find_one({"run_id": self.run_id, "t": "skill_called",
                                        "skill_call_id": call_id, "error": None})

    def validate_evidence(self, ids: list[str], protocol: str):
        if ids and self.db.chunks.count_documents({"_id": {"$in": ids},
                                                   "protocol_id": protocol}) != len(set(ids)):
            raise ValueError("Evidence must reference source chunks from this protocol")

    def validate_state(self, state: dict, workflow: dict):
        self.validate_evidence(state["evidence"], workflow["protocol_id"])
        if not state["strands"]["top"] and not state["strands"]["bottom"]:
            raise ValueError("A molecular state must have at least one segment")
        if state["origin"] in {"human", "memory"}:
            raise ValueError("The agent cannot claim human or memory provenance")
        if state["review_status"] != "unreviewed" or state["stale_since_revision"] is not None:
            raise ValueError("The agent creates unreviewed states with no stale revision")
        if ("evidence_required" in self.harness["guardrails"] and not state["evidence"]
                and state["origin"] not in {"skill", "human"}):
            raise ValueError("evidence_required: this state needs at least one source chunk")
        if "bottom_strand_3to5" in self.harness["guardrails"] and bottom_is_5to3(state):
            raise ValueError("bottom_strand_3to5: bottom strand is listed 5′→3′; "
                             "list it 3′→5′, aligned under the top strand, before committing.")
        segments = state["strands"]["top"] + state["strands"]["bottom"]
        if any(s["origin"] in {"human", "memory"} for s in segments):
            raise ValueError("The agent cannot claim human or memory segment provenance")
        if state["origin"] == "skill":
            event = self.skill_event(state["skill_call_id"])
            if not event or event["result"] != state:
                raise ValueError("A skill state must exactly match a successful skill call result")
        elif state["skill_call_id"] is not None:
            raise ValueError("Only skill-produced states may have skill_call_id")
        # Carried skill-origin segments are legitimate; newly invented ones are not.
        known = {json.dumps(s, sort_keys=True) for prior in workflow["states"]
                 for s in prior["strands"]["top"] + prior["strands"]["bottom"]
                 if s["origin"] == "skill"}
        if state["origin"] != "skill" and any(
                s["origin"] == "skill" and json.dumps(s, sort_keys=True) not in known
                for s in segments):
            raise ValueError("Skill-origin segments must come from a committed skill result")

    def validate_operation(self, transition: dict, state: dict):
        skill = next((s for s, op in OPERATIONS.items() if op == transition["op"]), None)
        access = self.harness["tool_access"].get(skill, "off")
        event = self.skill_event(transition["skill_call_id"])
        if access == "mandatory" and not event:
            raise ValueError(f"{skill} is mandatory: reference a successful skill call")
        if transition["skill_call_id"] and (
            not event or event["skill"] != skill
            or event["inputs"]["substrate_id"] != transition["from"]
            or event["result"] != state
        ):
            raise ValueError("skill_call_id must match this operation, substrate and product")
        if "provenance_required" in self.harness["guardrails"] and access != "off":
            if any(s["origin"] == "llm" for row in state["strands"].values() for s in row):
                raise ValueError(f"provenance_required: LLM-origin segments blocked for {transition['op']}")

    def dispatch(self, name: str, arguments: dict) -> dict:
        try:
            if name not in ARGUMENTS:
                raise ValueError(f"Unknown tool: {name}")
            arguments = ARGUMENTS[name].model_validate(arguments).model_dump(by_alias=True)
            run = self.db.runs.find_one({"_id": self.run_id})
            if not run or run["status"] != "running" or self.finished:
                raise ValueError("Run is not accepting tool calls")
            if run["step"] >= MAX_STEPS:
                raise ValueError("Run event budget exhausted")
            result = self.execute(name, arguments)
        except ValueError as exc:
            reason = (json.dumps(exc.errors(include_input=False, include_context=False, include_url=False))
                      if isinstance(exc, ValidationError) else str(exc))
            emit(self.run_id, "guardrail_blocked", tool=name, reason=reason)
            return {"error": reason}
        checkpoint(self.run_id)
        return result

    def execute(self, name: str, args: dict) -> dict:
        workflow = self.workflow()
        revision = workflow["workflow_revision"]
        states = {s["id"]: s for s in workflow["states"]}
        if name == "list_sources":
            return {"sources": list_sources(workflow["protocol_id"])}
        if name == "read_page":
            page = read_page(args["chunk_id"], workflow["protocol_id"])
            emit(self.run_id, "evidence_searched", query=f"read_page {args['chunk_id']}", results=[page])
            return page
        if name == "search_evidence":
            results = search_evidence(args["query"], workflow["protocol_id"], self.harness["evidence_k"])
            if self.harness["context_policy"]["include_linked_oligos"]:
                # Seeded oligo tables are protocol-linked source chunks, not annotations.
                seen = {r["chunk_id"] for r in results}
                for chunk in self.db.chunks.find({"protocol_id": workflow["protocol_id"], "kind": "table"}):
                    if chunk["_id"] not in seen:
                        results.append({"chunk_id": chunk["_id"], "page": chunk["page"], "snippet": chunk["text"]})
            emit(self.run_id, "evidence_searched", query=args["query"], results=results)
            return {"results": results}
        if name in INPUT_NAMES:
            substrate_key, oligo_key = INPUT_NAMES[name]
            substrate = args[substrate_key]
            if states.get(substrate["id"]) != substrate:
                raise ValueError("The cDNA substrate must exactly match a committed state")
            args = {"skill": name, "substrate_id": substrate["id"], "oligo_name": args[oligo_key]}
            name = "run_skill"
        if name == "run_skill":
            skill = args["skill"]
            if self.harness["tool_access"].get(skill, "off") == "off":
                raise ValueError(f"Skill {skill} is disabled")
            call_id, result, error = f"sk_{uuid4().hex[:12]}", None, None
            try:
                if args["substrate_id"] not in states:
                    raise ValueError("Commit the substrate before calling a skill")
                substrate_key, oligo_key = INPUT_NAMES[skill]
                result = call_skill(skill, {substrate_key: states[args["substrate_id"]],
                                           oligo_key: args["oligo_name"]})
                result["skill_call_id"] = call_id
                result = MoleculeState.model_validate(result).model_dump()
            except ValueError as exc:
                error = str(exc)
            emit(self.run_id, "skill_called", skill_call_id=call_id, skill=skill,
                 inputs={"substrate_id": args["substrate_id"], "oligo": args["oligo_name"]},
                 result=result, error=error)
            return {"state": result, "skill_call_id": call_id, "error": error}
        if name in {"commit_state", "revise_state"}:
            state = args["state"]
            self.validate_state(state, workflow)
            if name == "commit_state":
                if state["id"] in states:
                    raise ValueError("State ID already committed; use revise_state")
                emit(self.run_id, "state_committed", state=state, workflow_revision=revision)
            else:
                state_id = args["state_id"]
                if state_id not in states or state["id"] != state_id:
                    raise ValueError("Revision must preserve an existing state's ID")
                for edge in workflow["transitions"]:
                    if edge["to"] == state_id:
                        self.validate_operation(edge, state)
                emit(self.run_id, "state_revised", state_id=state_id, before=states[state_id],
                     after=state, caused_by="agent", workflow_revision=revision + 1,
                     stale=sorted(downstream(workflow, state_id)))
            return {"state": state}
        if name == "commit_transition":
            edge = args["transition"]
            self.validate_evidence(edge["evidence"], workflow["protocol_id"])
            if edge["from"] not in states or edge["to"] not in states:
                raise ValueError("Both transition endpoints must be committed states")
            if any(state_id not in states for state_id in edge["discarded"]):
                raise ValueError("Discarded products must be committed states")
            if edge["to"] in edge["discarded"]:
                raise ValueError("The carried product cannot also be discarded")
            for target in [edge["to"], *edge["discarded"]]:
                if edge["from"] == target or edge["from"] in downstream(workflow, target):
                    raise ValueError("Transition would create a cycle")
            if any(e["id"] == edge["id"] for e in workflow["transitions"]):
                raise ValueError("Transition ID already exists")
            self.validate_operation(edge, states[edge["to"]])
            emit(self.run_id, "transition_committed", transition=edge, workflow_revision=revision)
            return {"transition": edge}
        if name == "assume":
            emit(self.run_id, "assumption", text=args["text"])
            return {"recorded": True}
        if name == "finish":
            if not states:
                raise ValueError("Cannot finish an empty workflow")
            self.finished = True
            return {"finished": True, "states": len(states), "transitions": len(workflow["transitions"])}
        raise ValueError(f"Unknown tool: {name}")
