"""Backfill the selected panel and verify nearest-read citations and preserved reviews."""

from copy import deepcopy
import json
from pathlib import Path
import sys
from unittest.mock import patch

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_benchmark as importer
from db import get_db
from harbor import NORMALIZATION_VERSION, link_state_evidence
from check_m14 import safety_check


def mapping_check():
    read = lambda *ids: {"t": "evidence_searched", "results": [{"chunk_id": cid} for cid in ids]}
    commit = lambda sid, ids: {"t": "state_committed", "state": {"id": sid, "evidence": ids}}
    original = [commit("early", []), read("old"), read("first"), read("second", "first"), read(),
                read("third"), commit("filled", []), commit("cited", ["explicit"]), read("later"),
                {"t": "state_revised", "state_id": "filled", "before": {"id": "filled", "evidence": []},
                 "after": {"id": "filled", "label": "Human edit", "evidence": []}},
                {"t": "state_revised", "state_id": "cited", "before": {"id": "cited", "evidence": ["explicit"]},
                 "after": {"id": "cited", "evidence": ["human"]}}]
    snapshot = deepcopy(original)
    events, evidence = link_state_evidence(original)
    assert original == snapshot
    assert events[0]["state"]["evidence"] == []  # No evidence from future reads.
    assert events[6]["state"]["evidence"] == ["third", "second", "first"]
    assert events[7]["state"]["evidence"] == ["explicit"]
    assert events[9]["before"]["evidence"] == events[9]["after"]["evidence"] == ["third", "second", "first"]
    assert evidence["cited"] == ["human"] and events[9]["after"]["label"] == "Human edit"
    assert link_state_evidence(events)[0] == events
    print("Nearest reads: ordered, deduplicated, no future evidence; explicit citations and review edits preserved.", flush=True)


def without_evidence(workflow):
    value = deepcopy(workflow)
    for state in value["states"]:
        state.pop("evidence")
    return value


def check():
    mapping_check()
    db = get_db()
    runs = list(db.runs.find({"source": {"$in": ["benchmark", "harbor"]}}))
    assert len(runs) == 20
    ids = [r["run_id"] for r in runs]
    before = {w["run_id"]: w for w in db.workflows.find({"run_id": {"$in": ids}})}
    related = {name: list(db[name].find()) for name in ("reviews", "entities", "signals")}
    prepared = importer.prepare_record(db.benchmark_records.find_one({"_id": runs[0]["benchmark_record_id"]}))
    safety_check(prepared)
    with patch.object(importer, "read_file", side_effect=AssertionError("Normalization read the checkout")):
        count = importer.normalize_records()
    states, links, chunks = 0, 0, set()
    for old in runs:
        rid = old["run_id"]
        run = db.runs.find_one({"_id": rid})
        workflow = db.workflows.find_one({"run_id": rid})
        assert run["normalization_version"] == NORMALIZATION_VERSION
        assert run["source"] == old["source"] and run["created_at"] == old["created_at"]
        assert without_evidence(workflow) == without_evidence(before[rid]), old["protocol_id"]
        events = list(db.events.find({"run_id": rid}, {"_id": 0}).sort("seq", 1))
        assert [e["seq"] for e in events] == list(range(1, run["step"] + 1))
        assert events[0]["t"] == "run_started" and events[-1]["t"] == "run_finished"
        nearest = []
        committed = {}
        for event in events:
            if event["t"] == "evidence_searched" and event["results"]:
                nearest = [[h["chunk_id"] for h in event["results"]], *nearest[:2]]
            elif event["t"] == "state_committed":
                evidence = list(dict.fromkeys(cid for group in nearest for cid in group))
                assert evidence and event["state"]["evidence"] == evidence
                committed[event["state"]["id"]] = evidence
        for state in workflow["states"]:
            assert state["evidence"] == committed[state["id"]]
            for cid in state["evidence"]:
                assert db.chunks.find_one({"_id": cid, "protocol_id": run["protocol_id"]}), cid
            states += 1
            links += len(state["evidence"])
            chunks.update(state["evidence"])
    assert all(list(db[name].find()) == documents for name, documents in related.items())
    versions = {r["_id"]: r for r in db.runs.find()}
    with patch.object(importer, "read_file", side_effect=AssertionError("Normalization read the checkout")):
        assert importer.normalize_records() == 0
    assert versions == {r["_id"]: r for r in db.runs.find()}
    print(json.dumps({"normalized_runs": count, "states_with_evidence": states,
                      "evidence_links": links, "distinct_chunks": len(chunks), "reviews_preserved": len(related["reviews"])}))
    print("IMPORT EVIDENCE DONE-WHEN PASSED; other graph fields, scores, reviews and live-run exclusion preserved.", flush=True)


if __name__ == "__main__":
    check()
