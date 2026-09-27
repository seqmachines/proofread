"""Check the real two-candidate M7 loop, or print progress without new runs."""

import argparse
import ast
from copy import deepcopy
import json
from pathlib import Path

from db import get_db
from engine import emit
from harness_changes import SETTINGS, apply_patches, gate_payload


def snapshot(run_id):
    db = get_db()
    events = list(db.events.find({"run_id": run_id}, {"_id": 0}).sort("seq", 1))
    ids = [e["version"] for e in events if e["t"] == "harness_candidate"]
    versions = list(db.harness_versions.find({"_id": {"$in": ids}}).sort("created_at", 1))
    runs = []
    for run in db.runs.find({"harness_version": {"$in": ids}}).sort("created_at", 1):
        workflow = db.workflows.find_one({"run_id": run["_id"]})
        failures = [e["message"] for e in db.events.find({"run_id": run["_id"], "t": "error"})]
        latest = {c["check"]: c for c in workflow["checks"]}
        runs.append({"run_id": run["_id"], "protocol_id": run["protocol_id"],
                     "version": run["harness_version"], "status": run["status"], "step": run["step"],
                     "states": len(workflow["states"]), "gt_score": workflow["gt_score"],
                     "failed_checks": [c for c in latest.values() if c["status"] == "fail"], "errors": failures})
    return events, versions, runs


def check(run_id, fixture, followup):
    db = get_db()
    events, versions, runs = snapshot(run_id)
    assert len(versions) == 2, "Both candidates must finish first"
    v1, v2 = versions
    assert v1["_id"] == "v1" and v1["parent_id"] == "v0"
    assert v1["tool_access"]["template_switch"] == "mandatory"
    assert v1["guardrails"] == ["evidence_required", "provenance_required"]
    assert v2["_id"] == "v2" and v2["parent_id"] == ("v1" if v1["eval"]["decision"] == "promote" else "v0")
    parent = db.harness_versions.find_one({"_id": v2["parent_id"]})
    assert v2["guardrails"] == parent["guardrails"] + ["bottom_strand_3to5"]
    assert all(v2[k] == parent[k] for k in ("rules", "tool_access", "context_policy"))
    for version in versions:
        parent = db.harness_versions.find_one({"_id": version["parent_id"]})
        assert apply_patches(parent, version["patches"]) == {k: version[k] for k in SETTINGS}
        evaluation = version["eval"]
        payload = gate_payload(version["_id"], evaluation)
        result_events = [e for e in events if e["t"] == "gate_result" and e["version"] == version["_id"]]
        assert len(result_events) == 1
        assert {k: result_events[0][k] for k in payload} == payload
        rows = [evaluation["target"], *evaluation["regression"]]
        for row in rows:
            before = db.workflows.find_one({"run_id": row["baseline_run_id"]})
            after = db.workflows.find_one({"run_id": row["run_id"]})
            assert row["before"] == before["gt_score"]["structure_f1"]
            assert row["after"] == after["gt_score"]["structure_f1"]
            assert before["harness_version"] == "v0" and after["harness_version"] == version["_id"]
            assert after["protocol_id"] == before["protocol_id"] == row["protocol_id"]
        qualifies = (all(r["status"] == "done" for r in rows) and rows[0]["delta"] >= .05
                     and min(r["delta"] for r in rows[1:]) >= -.02)
        assert (evaluation["decision"] == "promote") == qualifies
        promotions = [e for e in events if e["t"] == "harness_promoted" and e["version"] == version["_id"]]
        assert len(promotions) == int(qualifies)
        for sid in version["source_signals"]:
            assert db.signals.find_one({"_id": sid})["processed"] is True
    assert len(list(db.harness_versions.find({"status": "active"}))) == 1
    first_result = next(e for e in events if e["t"] == "gate_result" and e["version"] == "v1")
    second_candidate = next(e for e in events if e["t"] == "harness_candidate" and e["version"] == "v2")
    assert first_result["seq"] < second_candidate["seq"]
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["t"] == "run_finished" and events[-1]["status"] == "done"
    assert [json.loads(line) for line in fixture.read_text().splitlines()] == events
    v0 = db.harness_versions.find_one({"_id": "v0"})
    assert v0["guardrails"] == ["evidence_required"] and v0["tool_access"]["template_switch"] == "available"
    workflow = db.workflows.find_one({"run_id": run_id})
    assert len(workflow["states"]) == 5 and len(workflow["transitions"]) == 4
    assert not any(e["t"] == "state_revised" for e in events)

    # Exercise write-time rejection against Atlas: the invalid candidate and
    # event must both roll back, without consuming a sequence or source signal.
    active = db.harness_versions.find_one({"status": "active"})
    invalid = deepcopy(v2)
    invalid.update(_id="invalid-m7-check", parent_id=active["_id"], status="candidate", eval=None)
    invalid["patches"] = [{"type": "rewrite_workflow", "path": "states", "from": [], "to": [], "reason": "invalid"}]
    try:
        emit(run_id, "harness_candidate", harness_document=invalid, version=invalid["_id"],
             parent=active["_id"], patches=invalid["patches"])
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid patch reached storage")
    assert db.runs.find_one({"_id": run_id})["step"] == len(events)
    assert db.harness_versions.find_one({"_id": invalid["_id"]}) is None
    for patch in [
        {"type": "rule", "path": "rules", "from": [], "to": ["Apply everywhere"], "reason": "invalid"},
        {"type": "rule", "path": "rules", "from": [], "to": ["[pcr] Change every operation"], "scope": "pcr", "reason": "invalid"},
        {"type": "context_policy", "path": "context_policy.history", "from": "full", "to": "state_only", "reason": "invalid"},
        {"type": "tool_access", "path": "tool_access.unknown", "from": "off", "to": "mandatory", "reason": "invalid"},
    ]:
        try:
            apply_patches(v0, [patch])
        except ValueError:
            pass
        else:
            raise AssertionError("Forbidden patch accepted")

    # Follow local imports transitively, including imports inside functions.
    root = Path(__file__).parent
    visited, pending = set(), ["agent"]
    while pending:
        module = pending.pop()
        if module in visited or not (root / f"{module}.py").exists():
            continue
        visited.add(module)
        tree = ast.parse((root / f"{module}.py").read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                pending.append(node.module.split(".")[0])
            elif isinstance(node, ast.Import):
                pending.extend(alias.name.split(".")[0] for alias in node.names)
    assert not visited & {"gate", "verifier", "evolver", "seed", "setup_db"}
    passed = False
    if followup:
        run = db.runs.find_one({"_id": followup})
        state = db.workflows.find_one({"run_id": followup})
        latest = {c["check"]: c for c in state["checks"]}
        passed = (v1["eval"]["decision"] == "promote" and run["status"] == "done"
                  and run["protocol_id"] == "smart_seq3" and run["harness_version"] == "v1"
                  and latest["strand_consistency"]["status"] == "pass")
    return {"run_id": run_id, "events": len(events), "gate_results": [gate_payload(v["_id"], v["eval"]) for v in versions],
            "loop_integrity": "passed", "original_m7_done_when": passed, "followup_run": followup}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--progress", action="store_true")
    parser.add_argument("--fixture", type=Path, default=Path("fixtures/run_example.jsonl"))
    parser.add_argument("--followup")
    args = parser.parse_args()
    if args.progress:
        events, versions, runs = snapshot(args.run_id)
        print(json.dumps({"versions": [{k: v[k] for k in ("_id", "parent_id", "status", "eval")} for v in versions],
                          "runs": runs, "events": len(events)}, indent=2))
    else:
        print(json.dumps(check(args.run_id, args.fixture, args.followup), indent=2))
