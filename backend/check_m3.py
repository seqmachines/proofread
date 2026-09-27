"""M3 done-when check through POST /runs, live SSE, and persisted snapshots."""

import argparse
import json
import urllib.request


def get(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def check(base):
    request = urllib.request.Request(base + "/runs", data=json.dumps({
        "protocol_id": "smart_seq2", "harness_version": "v0",
    }).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        run_id = json.load(response)["run_id"]
    print(f"RUN_ID={run_id}", flush=True)
    events = []
    with urllib.request.urlopen(f"{base}/runs/{run_id}/stream", timeout=45) as response:
        for line in response:
            if not line.startswith(b"data: "):
                continue
            event = json.loads(line[6:])
            events.append(event)
            print(json.dumps({k: event[k] for k in ("seq", "t", "goal", "status", "message", "reason") if k in event}), flush=True)
            if event["t"] == "run_finished":
                break
    snapshot = get(f"{base}/runs/{run_id}")
    workflow = snapshot["workflow"]
    summary = {"run_id": run_id, "status": snapshot["run"]["status"],
               "states": len(workflow["states"]), "transitions": len(workflow["transitions"]),
               "events": len(events), "tokens": snapshot["run"]["tokens"],
               "guardrail_blocks": sum(e["t"] == "guardrail_blocked" for e in events),
               "skill_errors": sum(e["t"] == "skill_called" and bool(e["error"]) for e in events)}
    print(json.dumps(summary, indent=2), flush=True)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1)), "SSE event gap"
    assert snapshot["run"]["status"] == "done", "Run failed"
    assert len(workflow["states"]) >= 5, "M3 requires at least five persisted states"
    assert events[-1]["t"] == "run_finished", "No terminal event"
    print("M3 DONE-WHEN PASSED", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    check(args.base.rstrip("/"))
