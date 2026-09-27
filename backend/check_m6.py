"""M6 done-when check, including the two requested independent proposals."""

import argparse
import json

from db import get_db
from review_models import Signal


def check(run_id):
    db = get_db()
    run = db.runs.find_one({"_id": run_id})
    workflow = db.workflows.find_one({"run_id": run_id})
    signals = list(db.signals.find({"run_id": run_id}))
    events = list(db.events.find({"run_id": run_id}).sort("seq", 1))
    v0 = db.harness_versions.find_one({"_id": "v0"})
    assert run["status"] == "done" and run["harness_version"] == "v0"
    assert any(s["harness_relevance"] == "high" and s["proposed_patch"] for s in signals)
    assert v0["guardrails"] == ["evidence_required"]
    assert v0["tool_access"]["template_switch"] == "available"
    latest = {e["signal_id"]: e for e in events if e["t"] == "review_finding"}
    for signal in signals:
        Signal.model_validate(signal)
        event = latest[signal["_id"]]
        assert signal["processed"] is False and signal["systematic"] is False
        for field in ("root_cause", "operation", "state_id", "recommended_action", "harness_relevance"):
            assert signal[field] == event[field], "Signal and latest finding disagree"
    high = [s for s in signals if s["harness_relevance"] == "high"]
    switching = next(s for s in high if s["proposed_patch"]["path"] == "tool_access.template_switch")
    orientation = next(s for s in high if s["error_type"] == "strand_or_orientation_error")
    assert switching["_id"] != orientation["_id"]
    assert switching["proposed_patch"]["from"] == "available" and switching["proposed_patch"]["to"] == "mandatory"
    assert orientation["operation"] == "pcr" and orientation["state_id"] == "cdna_amp"
    assert orientation["root_cause"] == "bottom_strand_listed_5to3"
    assert orientation["proposed_patch"]["type"] == "guardrail"
    assert orientation["proposed_patch"]["from"] == ["evidence_required"]
    assert orientation["proposed_patch"]["to"] == ["evidence_required", "bottom_strand_3to5"]
    assert events[-1]["t"] == "run_finished" and events[-1]["status"] == "done"
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert not any(e["t"] in {"harness_candidate", "gate_result", "harness_promoted", "state_revised"} for e in events)
    assert len(workflow["states"]) == 5 and len(workflow["transitions"]) == 4
    print(json.dumps({"run_id": run_id, "signals": [{"id": s["_id"], "signature": s["signature"],
                      "harness_relevance": s["harness_relevance"], "proposed_patch": s["proposed_patch"]}
                      for s in signals], "gt_score": workflow["gt_score"],
                      "events": len(events), "tokens": run["tokens"]}, indent=2, ensure_ascii=False))
    print("M6 DONE-WHEN PASSED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    args = parser.parse_args()
    check(args.run_id)
