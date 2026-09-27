"""Render the stored harness version without changing it."""

from pathlib import Path

from db import get_db
from cdna.skills import OPERATIONS
from cdna.tools import tool_definitions
from tool_models import ARGUMENTS

BASE_PROMPT = Path(__file__).with_name("base_prompt.md").read_text()
DESCRIPTIONS = {
    "search_evidence": "Search this protocol's source pages and oligo tables by text terms, ranked by relevance; returns chunk IDs and text. Use quoted phrases for exact matches.",
    "list_sources": "List this protocol's source documents and each page or sheet's chunk ID.",
    "read_page": "Read a full source page or table by its chunk ID, restricted to this protocol.",
    "run_skill": "Apply an enabled symbolic skill to a committed substrate; returns an uncommitted state.",
    "commit_state": "Persist a molecular state with evidence and provenance.",
    "commit_transition": "Connect two committed states, citing the operation and any successful skill call.",
    "revise_state": "Replace a committed state, bump revision and mark all downstream states stale.",
    "assume": "Record an explicit scientific assumption or uncertainty in the trace.",
    "finish": "Finish after committing the full protocol workflow through its final product.",
}


def render(version: str, workdir: Path | None = None, task: str = "") -> dict:
    harness = get_db().harness_versions.find_one({"_id": version})
    if harness is None:
        raise ValueError(f"Unknown harness version: {version}")
    enabled = [s for s in OPERATIONS if harness["tool_access"].get(s, "off") != "off"]
    prompt = BASE_PROMPT + "\n\n" + "\n".join(harness["rules"])
    for skill in enabled:
        if harness["tool_access"][skill] == "mandatory":
            prompt += (f"\nIf the protocol performs operation {OPERATIONS[skill]}, the product state "
                       f"must be constructed with the {skill} skill; never add an operation that "
                       "the evidence does not support. Call the skill through run_skill and commit "
                       "its successful result with the matching skill_call_id.")
    if "provenance_required" in harness["guardrails"]:
        prompt += "\nEvery segment needs provenance; LLM-origin segments are blocked for operations with an enabled skill."
    if "bottom_strand_3to5" in harness["guardrails"]:
        prompt += "\nThe bottom_strand_3to5 guardrail rejects bottom rows listed 5′→3′; list them 3′→5′ aligned under the top."
    prompt += "\nEnabled guardrails: " + ", ".join(harness["guardrails"]) + "."
    if task:
        prompt += "\n\n## Current task\n\n" + task
    if workdir is not None:
        (workdir / "AGENTS.md").write_text(prompt)
    tools = []
    for name, model in ARGUMENTS.items():
        if name in OPERATIONS:
            continue  # Mount cDNA's own definitions below, restricted by this harness.
        if name == "run_skill" and not enabled:
            continue
        schema = model.model_json_schema()
        if name == "run_skill":
            schema["properties"]["skill"]["enum"] = enabled
        tools.append({"type": "function", "function": {
            "name": name, "description": DESCRIPTIONS[name], "parameters": schema,
        }})
    for tool in tool_definitions():
        if tool["name"] in enabled:
            tools.append({"type": "function", "function": {
                "name": tool["name"], "description": tool["description"] +
                " In proofread, supply the exact committed substrate; the result carries a skill_call_id for commits.",
                "parameters": tool["inputSchema"],
            }})
    return {"system_prompt": prompt, "tools": tools,
            "evidence_k": harness["context_policy"]["evidence_k"],
            "context_policy": harness["context_policy"],
            "guardrails": harness["guardrails"], "tool_access": harness["tool_access"]}
