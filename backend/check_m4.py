"""M4 done-when check: verify persisted scores, events, snapshots and GT diff."""

import argparse
import json
import urllib.request

CHECKS = {"graph_connected", "substrate_exists", "oligos_represented",
          "strand_consistency", "provenance_present"}


def get(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def check(base, run_id):
    snapshot = get(f"{base}/runs/{run_id}")
    events = get(f"{base}/runs/{run_id}/events")
    diff = get(f"{base}/runs/{run_id}/gt-diff")
    run, workflow = snapshot["run"], snapshot["workflow"]
    checks = [{k: v for k, v in e.items() if k not in {"run_id", "seq", "ts", "t"}}
              for e in events if e["t"] == "verifier_check"]
    scored = [e for e in events if e["t"] == "gt_scored"]
    assert run["protocol_id"] == "smart_seq2" and run["harness_version"] == "v0"
    assert run["status"] == "done" and run["baseline"] is True
    assert {c["check"] for c in checks} == CHECKS
    assert any(c["status"] == "fail" for c in checks)
    assert workflow["checks"] == checks, "Snapshot differs from verifier events"
    assert scored and set(workflow["gt_score"]) == {"structure_f1", "edge_f1"}
    assert workflow["gt_score"] == {key: scored[-1][key] for key in ("structure_f1", "edge_f1")}
    assert all(0 <= value <= 1 for value in workflow["gt_score"].values())
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["t"] == "run_finished" and events[-1]["status"] == "done"
    assert scored[-1]["seq"] > max(e["seq"] for e in events if e["t"] == "verifier_check")
    assert set(diff) == {"missing_states", "extra_states", "missing_edges", "extra_edges"}
    print(json.dumps({"run_id": run_id, "scores": workflow["gt_score"],
                      "failed_checks": [c["check"] for c in checks if c["status"] == "fail"],
                      "events": len(events), "missing_states": [s["id"] for s in diff["missing_states"]]}, indent=2))
    print("M4 DONE-WHEN PASSED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    check(args.base.rstrip("/"), args.run_id)
