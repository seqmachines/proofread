"""M4: GT-free checks and isolated, gate/GT-diff-only truth evaluation."""

import re

from db import get_db
from engine import emit
from structure import project_workflow, score
from segments import role, words

CHECKS = ("graph_connected", "substrate_exists", "oligos_represented",
          "strand_consistency", "provenance_present")

# Named oligos in prose, including the alternate vendor spellings in source
# tables. Transition.oligos and successful skill inputs add arbitrary names.
OLIGOS = {
    "TSO": r"\bTSOs?\b|template[- ]switch(?:ing)? oligo",
    "oligo-dT": r"oligo[- (]?dT",
    "ISPCR": r"\bISPCR\b",
    "P5": r"\bP5\b", "P7": r"\bP7\b",
    "i5": r"\bi5\b|\bN[ /]?S5xx\b|\bN5xx\b|Index 2 primers",
    "i7": r"\bi7\b|\bN7xx\b|Index 1 primers",
}


def check_workflow(workflow, chunks, events):
    """Pure checks: receives source evidence and run events, never truth."""
    states = {s["id"]: s for s in workflow["states"]}
    transitions = workflow["transitions"]
    evidence = {c["_id"]: c for c in chunks if c["protocol_id"] == workflow["protocol_id"]}
    problems = {name: [] for name in CHECKS}

    def fail(check, message, state=None, chunks=()):
        problems[check].append((message, state, list(chunks)))

    neighbors = {sid: set() for sid in states}
    for t in transitions:
        endpoints = [t["from"], t["to"], *t.get("discarded", [])]
        absent = [sid for sid in endpoints if sid not in states]
        if absent:
            fail("substrate_exists", f"{t['id']} references missing state(s): {', '.join(absent)}.", chunks=t["evidence"])
        for target in endpoints[1:]:
            if t["from"] in states and target in states:
                neighbors[t["from"]].add(target)
                neighbors[target].add(t["from"])
    remaining = set(states)
    components = []
    while remaining:
        seen, pending = set(), [min(remaining)]
        while pending:
            sid = pending.pop()
            if sid not in seen:
                seen.add(sid)
                pending.extend(neighbors[sid] - seen)
        components.append(sorted(seen))
        remaining -= seen
    if len(components) != 1:
        fail("graph_connected", f"Expected one connected workflow; found {len(components)} components: {components}.",
             min(components, key=len)[0] if components else None)

    segments = [s for state in states.values() for strand in state["strands"].values() for s in strand]
    segment_roles = {role(s["name"], s["type"]) for s in segments}
    names = {words(s["name"]) for s in segments}
    named = {}
    for chunk_id, chunk in evidence.items():
        text = chunk["text"]
        for name, pattern in OLIGOS.items():
            if re.search(pattern, text, re.I):
                named.setdefault(name, set()).add(chunk_id)
        # Named table entries and prose declarations complement the aliases.
        for line in text.splitlines():
            declaration = re.match(r"\s*([\w.+()/-]+)\s+(?:oligo(?:nucleotide)?|primer)\s*(?:[(:|]|5[′'])", line, re.I)
            if declaration and declaration[1].lower() not in {"the", "a", "pcr", "reverse", "forward"}:
                named.setdefault(declaration[1], set()).add(chunk_id)
    for t in transitions:
        for name in t.get("oligos", []):
            named.setdefault(name, set()).update(t["evidence"])
    for event in events:
        if event["t"] == "skill_called" and event.get("result") and not event.get("error"):
            named.setdefault(event["inputs"]["oligo"], set()).update(event["result"]["evidence"])
    for name, ids in sorted(named.items()):
        if role(name) not in segment_roles and not any(words(name) in s for s in names):
            fail("oligos_represented", f"Named oligo {name!r} has no corresponding segment.", chunks=sorted(ids))

    def ordered(state, side):
        return [role(s["name"], s["type"]) for s in state["strands"][side]]

    for t in transitions:
        if t["from"] not in states or t["to"] not in states:
            continue
        before, after = states[t["from"]], states[t["to"]]
        if t["op"] != "fragmentation":
            for side in ("top", "bottom"):
                a, b = ordered(before, side), ordered(after, side)
                # Unique retained segments establish order without guessing
                # which copy of a repeated adapter survived an operation.
                common = {s for s in a if a.count(s) == b.count(s) == 1}
                if [s for s in a if s in common] != [s for s in b if s in common]:
                    fail("strand_consistency", f"{t['id']} ({t['op']}) reverses retained {side}-strand segment order.", after["id"], t["evidence"])
        a = {x for side in ("top", "bottom") for x in ordered(before, side)}
        b = {x for side in ("top", "bottom") for x in ordered(after, side)}
        if t["op"] == "pcr" and "tso" in b - a and "TSO" in named:
            fail("strand_consistency", f"{t['id']}: PCR product introduces a TSO-derived handle absent from substrate {before['id']}; the template-switching intermediate/transition is missing before PCR.",
                 after["id"], sorted(named["TSO"]))
    for state in states.values():
        top, bottom = ordered(state, "top"), ordered(state, "bottom")
        # Contract displays bottom 3′→5′, so corresponding segments align in
        # the same left-to-right order, even when their chemistry differs.
        common = {s for s in top if top.count(s) == bottom.count(s) == 1}
        if [s for s in top if s in common] != [s for s in bottom if s in common]:
            fail("strand_consistency", f"{state['id']}: bottom strand is not aligned 3′→5′ under top; shared segment order differs.", state["id"], state["evidence"])

    skills = {e["skill_call_id"]: e for e in events if e["t"] == "skill_called" and e.get("result") and not e.get("error")}
    for state in states.values():
        call = skills.get(state.get("skill_call_id"))
        skill_provenance = call is not None and call["result"]["strands"] == state["strands"]
        source_provenance = bool(state["evidence"]) and all(c in evidence for c in state["evidence"])
        if not (source_provenance or skill_provenance):
            fail("provenance_present", f"{state['id']} has neither valid protocol evidence nor a matching successful skill result.", state["id"], state["evidence"])

    passed = {
        "graph_connected": "All states belong to one connected workflow (including discarded products).",
        "substrate_exists": "Every substrate, carried product and discarded product exists.",
        "oligos_represented": f"All {len(named)} recognized named oligos in evidence/transition links have corresponding segments.",
        "strand_consistency": "Retained segment order and aligned strand orientation are consistent; no unsupported TSO introduction at PCR.",
        "provenance_present": "Every state has valid source evidence or recorded skill provenance.",
    }
    results = []
    for check in CHECKS:
        failures = problems[check]
        result = {"check": check, "status": "fail" if failures else "pass",
                  "message": " ".join(p[0] for p in failures) if failures else passed[check]}
        state_id = next((p[1] for p in failures if p[1]), None)
        if state_id:
            result["state_id"] = state_id
        ids = sorted({c for p in failures for c in p[2] if c in evidence})
        if ids:
            result["evidence"] = ids
        results.append(result)
    return results


def verify_run(run_id):
    db = get_db()
    workflow = db.workflows.find_one({"run_id": run_id})
    if workflow is None:
        raise ValueError(f"Unknown workflow: {run_id}")
    events = list(db.events.find({"run_id": run_id}).sort("seq", 1))
    ids = {c for entity in workflow["states"] + workflow["transitions"] for c in entity["evidence"]}
    ids.update(r["chunk_id"] for e in events if e["t"] == "evidence_searched" for r in e["results"])
    chunks = list(db.chunks.find({"protocol_id": workflow["protocol_id"], "_id": {"$in": sorted(ids)}},
                                {"_id": 1, "protocol_id": 1, "page": 1, "text": 1}))
    checks = check_workflow(workflow, chunks, events)
    for result in checks:
        emit(run_id, "verifier_check", **result)
    return checks


class NoGroundTruth(ValueError):
    pass


def compare_ground_truth(run_id, *, workflow=None, session=None, review_target_id=None):
    """Gate, GT-diff and post-run review scoring; never executor verification."""
    db = get_db()
    if workflow is None:
        workflow = db.workflows.find_one({"run_id": run_id}, session=session)
    if workflow is None:
        raise ValueError(f"Unknown workflow: {run_id}")
    truth = db.ground_truth.find_one({"protocol_id": workflow["protocol_id"]}, session=session)
    if truth is None:
        raise NoGroundTruth(f"No ground truth for {workflow['protocol_id']}")
    native = truth.get("scoring_workflows")
    if not native:
        raise ValueError("Reseed structural metadata: python backend/seed.py --ground-truth-only")
    # §2.1 stores one merged graph; native IDs are unique across workflows.
    merged = {key: [x for w in native for x in w[key]] for key in
              ("states", "transitions", "initial_state_ids", "final_outputs")}
    projected = project_workflow(workflow)
    metrics, diff, matches = score(projected, merged)
    diff["missing_states"] = [s for s in truth["states"] if s["id"] in diff["missing_states"]]
    diff["extra_states"] = [s for s in workflow["states"] if s["id"] in diff["extra_states"]]
    result = {"run_id": run_id, "scores": metrics, "diff": diff, "matches": matches}
    if review_target_id is not None:
        state = next((s for s in projected["states"] if s["state_id"] == review_target_id), None)
        if state is not None:
            match = next((m for m in matches if m["state_id"] == review_target_id), None)
            result["review_target_disagrees"] = match is None or match["similarity"] not in (None, 1.0)
        else:
            transition = next((t for t in projected["transitions"] if t["transition_id"] == review_target_id), None)
            state_map = {m["state_id"]: m["truth_id"] for m in matches}
            fields = ("substrate_state_ids", "product_state_ids", "carried_forward_product_ids", "discarded_product_ids")
            result["review_target_disagrees"] = not transition or not any(
                transition["operation"] == t["operation"] and
                set(transition["oligo_ids"]) == set(t["oligo_ids"]) and
                all({state_map.get(s) for s in transition[key]} == set(t[key]) for key in fields)
                for t in merged["transitions"])
    return result
