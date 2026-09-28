"""M14 done-when: normalize the saved panel and replay a paper baseline's trace.

python -m backend.check_m14 --base https://proofread-api-7jj27cadja-uk.a.run.app
Uses the selected 20 real runs; preserves their graphs, scores, and reviews.
"""

import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch
from urllib.request import urlopen
from uuid import uuid4

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_benchmark as importer
from db import get_db
from engine import emit
from harbor import NORMALIZATION_VERSION, map_trajectory
from verifier_text import public_event


def get(base, path):
    with urlopen(base + path, timeout=60) as response:
        return json.load(response)


def safety_check(prepared):
    # Stated assumptions map; negated assumptions and file writes do not.
    sample = {"steps": [{"step_id": 1, "source": "agent",
        "message": "Assumption: the unspecified handle stays symbolic. I will not assume a kit sequence.",
        "tool_calls": [{"tool_call_id": "read", "function_name": "exec_command", "arguments": {"cmd": "cat /workspace/input/protocol.txt"}},
                       {"tool_call_id": "write", "function_name": "exec_command", "arguments": {"cmd": "echo output > /tmp/result.txt"}}],
        "observation": {"results": [{"source_call_id": "read", "content": [{"type": "text", "text": "PAGE 2\nTemplate switching uses a TSO. ACGTACGTACGT api_key=privatevalue"}]}]}}]}
    mapped = map_trajectory(json.dumps(sample), "fixture/agent/trajectory.json", "check")
    assert [e["t"] for e in mapped["events"]] == ["step_started", "assumption", "evidence_searched"]
    assert "ACGTACGTACGT" not in str(mapped) and "privatevalue" not in str(mapped)
    assert mapped["events"][-1]["results"][0]["page"] == 2

    # The same rebuild entry points must refuse live runs, even with a real archive.
    db = get_db()
    run_id = "m14_check_" + uuid4().hex
    try:
        emit(run_id, "run_started", protocol_id=prepared["protocol_id"], harness_version="v0", executor="none", source="live")
        emit(run_id, "run_finished", status="done")
        before = list(db.events.find({"run_id": run_id}))
        try:
            importer.import_record({**prepared, "run_id": run_id})
        except importer.ImportConflict as exc:
            assert "live" in str(exc)
        else:
            raise AssertionError("Importer accepted a live run")
        with db.client.start_session() as session, session.start_transaction():
            previous = db.runs.find_one({"_id": run_id}, session=session)
            try:
                emit(run_id, "run_started", protocol_id=prepared["protocol_id"], harness_version="v0",
                     executor="none", source="benchmark", import_record=prepared["provenance"],
                     _session=session, _import_batch={"previous": previous})
            except ValueError as exc:
                assert "live" in str(exc)
            else:
                raise AssertionError("Event writer accepted a live run")
        assert list(db.events.find({"run_id": run_id})) == before
    finally:
        for collection in (db.events, db.workflows, db.runs):
            collection.delete_many({"run_id": run_id})


def check(base):
    db = get_db()
    records = importer.archive_files(importer.RUNS_ROOT, source="harbor")
    assert len(records) == 20
    prepared = [importer.prepare_record(r) for r in records]
    ids = {r["run_id"] for r in prepared}
    before = {w["run_id"]: w for w in db.workflows.find({"run_id": {"$in": list(ids)}})}
    assert set(before) == ids
    old_runs = {r["run_id"]: r for r in db.runs.find({"run_id": {"$in": list(ids)}})}
    old_events = {run_id: list(db.events.find({"run_id": run_id}, {"_id": 0}).sort("seq", 1)) for run_id in ids}
    related = {name: list(db[name].find()) for name in ("reviews", "entities", "signals")}
    safety_check(prepared[0])
    print("Mapping and live-run exclusion passed.", flush=True)
    changed = importer.store_records(records)
    # Actual normalization must use MongoDB alone.
    with patch.object(importer, "read_file", side_effect=AssertionError("Normalization read the checkout")):
        normalized = importer.normalize_records()
    print(f"Archived {changed}; normalized {normalized} runs.", flush=True)

    totals = Counter()
    for p in prepared:
        run_id = p["run_id"]
        events = list(db.events.find({"run_id": run_id}, {"_id": 0}).sort("seq", 1))
        workflow = db.workflows.find_one({"run_id": run_id})
        assert workflow == before[run_id], p["protocol_id"]
        run = db.runs.find_one({"_id": run_id})
        assert run["normalization_version"] == NORMALIZATION_VERSION
        assert run["source"] == old_runs[run_id]["source"]
        assert events[0]["t"] == "run_started" and events[-1]["t"] == "run_finished"
        assert [e["seq"] for e in events] == list(range(1, run["step"] + 1))
        first_commit = next(e["seq"] for e in events if e["t"] == "state_committed")
        trace = [e for e in events if e["t"] in {"step_started", "evidence_searched", "assumption"}]
        assert all(e["seq"] < first_commit for e in trace)
        assert {"step_started", "evidence_searched"} <= {e["t"] for e in trace}
        assert [{k: v for k, v in e.items() if k not in {"run_id", "seq", "ts"}} for e in trace] == p["trace"]
        archive = db.benchmark_records.find_one({"_id": p["provenance"]["benchmark_record_id"]})
        if not old_runs[run_id].get("normalization_version"):
            assert archive["normalization"]["original_events"] == old_events[run_id]
        assert all(db.chunks.find_one({"_id": hit["chunk_id"]}) for e in trace
                   if e["t"] == "evidence_searched" for hit in e["results"])
        totals.update(e["t"] for e in trace)
    assert all(list(db[name].find()) == docs for name, docs in related.items())
    steps = {r["_id"]: r["step"] for r in db.runs.find()}
    assert importer.store_records(records) == 0
    with patch.object(importer, "read_file", side_effect=AssertionError("Normalization read the checkout")):
        assert importer.normalize_records() == 0
    assert {r["_id"]: r["step"] for r in db.runs.find()} == steps

    paper = next(p for p in prepared if p["protocol_id"] == "smart_seq")
    run_id = paper["run_id"]
    events = get(base, f"/runs/{run_id}/events")
    assert events == [public_event(e) for e in db.events.find({"run_id": run_id}, {"_id": 0}).sort("seq", 1)]
    streamed = []
    with urlopen(base + f"/runs/{run_id}/stream?since=0", timeout=60) as response:
        for line in response:
            if line.startswith(b"data: "):
                streamed.append(json.loads(line[6:]))
                if streamed[-1]["seq"] == events[-1]["seq"]:
                    break
    assert streamed == events
    assert get(base, f"/runs/{run_id}")["run"]["normalization_version"] == NORMALIZATION_VERSION
    hit = next(e["results"][0] for e in events if e["t"] == "evidence_searched" and "SUPPLEMENT PAGE" in e["results"][0]["snippet"])
    chunk = get(base, "/chunks/" + hit["chunk_id"])
    assert "Template switching" in chunk["text"] and chunk["page"] == hit["page"]
    assert sum(r["gt_scored_runs"] for r in get(base, "/benchmark")) == 20

    # Exercise the actual web reducer without editing or building web/.
    root = Path(__file__).resolve().parents[1]
    js = """
const fs = require('fs');
const ts = require('./web/node_modules/typescript');
const vm = require('vm');
const source = fs.readFileSync('web/lib/reducer.ts', 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exports = {}; vm.runInNewContext(code, {exports});
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const state = exports.fold(input.events);
if (state.trace.length < 2 || state.status !== 'done' || state.nodes.length !== input.states) throw Error('Replay failed');
if (!state.trace.some(s => s.events.some(e => e.t === 'evidence_searched'))) throw Error('Missing evidence');
console.log(JSON.stringify({trace_steps:state.trace.length,nodes:state.nodes.length,gt_score:state.gtScore}));
"""
    result = subprocess.run(["node", "-e", js], cwd=root, check=True, text=True, capture_output=True,
                            input=json.dumps({"events": events, "states": len(paper["graph"]["states"])}))
    print("Paper baseline web reducer: " + result.stdout.strip())
    print(json.dumps({"runs": len(ids), "trace_events": dict(totals), "paper_run_id": run_id}))
    print("M14 DONE-WHEN PASSED", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    check(args.base.rstrip("/"))
