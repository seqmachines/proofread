"""M2 done-when check: replay two stored events, then tail eight through curl -N."""

import argparse
import json
import subprocess
from urllib.request import urlopen

from engine import checkpoint, create_run, emit


def state(state_id, label):
    return {
        "id": state_id, "label": label,
        "strands": {"top": [{"name": "insert", "type": "insert", "origin": "human"}], "bottom": []},
        "origin": "human", "evidence": [], "skill_call_id": None,
        "review_status": "unreviewed", "stale_since_revision": None,
    }


def finish_fake_run(run_id):
    emit(run_id, "state_committed", state=state("S1", "M2 fake input"), workflow_revision=1)
    checkpoint(run_id, pending=["Commit fake output"])
    emit(run_id, "step_started", step=2, goal="Verify live delivery of the fake output.")
    emit(run_id, "state_committed", state=state("S2", "M2 fake output"), workflow_revision=1)
    emit(run_id, "transition_committed", transition={
        "id": "T1", "from": "S1", "to": "S2", "op": "other",
        "skill_call_id": None, "evidence": [],
    }, workflow_revision=1)
    emit(run_id, "assumption", text="This is the M2 transport check, not a reconstructed protocol.")
    checkpoint(run_id)
    emit(run_id, "run_finished", status="done")


def check(base_url):
    run_id = create_run("m2-probe")
    emit(run_id, "step_started", step=1, goal="Verify replay of the stored event prefix.")
    url = f"{base_url}/runs/{run_id}"
    print(f"M2 fake run: {run_id}", flush=True)
    curl = subprocess.Popen(["curl", "-f", "-sS", "-N", "--max-time", "45",
                             url + "/stream?since=0&speed=8"], stdout=subprocess.PIPE, text=True)
    seen = []
    try:
        for line in curl.stdout:
            if not line.startswith("data: "):
                continue
            print(line.rstrip(), flush=True)
            seen.append(json.loads(line[6:]))
            if len(seen) == 2:
                finish_fake_run(run_id)
            if len(seen) == 10:
                break
        if [event["seq"] for event in seen] != list(range(1, 11)):
            raise AssertionError("curl did not receive all ten events in order")
        if any(event["run_id"] != run_id for event in seen):
            raise AssertionError("Stream included an event from another run")
    finally:
        curl.terminate()
        curl.wait(timeout=5)
        curl.stdout.close()

    with urlopen(url + "/events?since=8", timeout=15) as response:
        assert json.load(response) == seen[8:]
    with urlopen(url, timeout=15) as response:
        snapshot = json.load(response)
    assert snapshot["run"]["step"] == 10
    assert snapshot["run"]["status"] == "done"
    assert snapshot["run"]["checkpoint"]["completed_states"] == ["S1", "S2"]
    assert len(snapshot["workflow"]["states"]) == 2
    assert len(snapshot["workflow"]["transitions"]) == 1
    print("M2 PASS: curl -N received seq 1–10; polling and run/checkpoint snapshots agree.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    check(parser.parse_args().base_url.rstrip("/"))
