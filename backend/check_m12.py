"""M12 done-when check: no embedding settings, text retrieval, live Smart-seq2."""

import json
import os
import sys
from pathlib import Path

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_db
from evidence import list_sources, read_page, search_evidence


def check():
    assert not any(k.startswith(("EMBED_", "VOYAGE_")) for k in os.environ), "Remove embedding settings first"
    db = get_db()
    expected = {"protocols", "chunks", "ground_truth", "benchmark_records", "harness_versions",
                "runs", "events", "workflows", "signals", "reviews", "entities"}
    assert expected <= set(db.list_collection_names())
    indexes = db.chunks.index_information()
    assert indexes["chunks_text"]["weights"] == {"text": 1}
    assert list(indexes["chunks_text"]["key"])[0] == ("protocol_id", 1)
    assert not list(db.chunks.list_search_indexes())
    assert not db.chunks.find_one({"embedding": {"$exists": True}})
    assert {c["kind"] for c in db.chunks.find({}, {"kind": 1})} <= {"page", "table"}

    sources = list_sources("smart_seq2")
    assert len(sources) == 5
    pages = {p["chunk_id"] for s in sources for p in s["pages"]}
    assert pages
    table_id = "smart_seq2:SMART-seq2_TSO_table.xlsx:sheet01"
    assert table_id in pages
    table = read_page(table_id, "smart_seq2")
    assert "TSO" in table["snippet"]
    results = search_evidence("template switching oligo", "smart_seq2")
    assert results and all(r["chunk_id"] in pages for r in results)
    assert results == search_evidence("template switching oligo", "smart_seq2"), "Unstable text result ordering"
    assert search_evidence("template switching oligo", "nonexistent-protocol") == []
    assert search_evidence("proofreadnonexistenttermqzxw", "smart_seq2") == []
    try:
        read_page(table_id, "sci_rna_seq")
    except ValueError:
        pass
    else:
        raise AssertionError("Page read leaked another protocol's source")

    # Importing the executor's tools must not load setup, seed or GT readers.
    from agent import AgentTools
    assert not {"setup_db", "seed", "verifier", "gate"} & set(sys.modules)
    from harness import render
    from engine import create_run
    from runner import run_reconstruction
    harness = render("v0")
    assert {"list_sources", "read_page", "search_evidence"} <= {
        t["function"]["name"] for t in harness["tools"]}
    run_id = create_run("smart_seq2", "v0")
    print(f"RUN_ID={run_id}", flush=True)
    print("Text index and protocol isolation passed; starting the live Codex run.", flush=True)
    # Both completion hooks remain enabled. A retrieval smoke run should not
    # create candidates or require regression baselines in an empty cluster.
    run_reconstruction(run_id, evolve=False)
    run = db.runs.find_one({"_id": run_id})
    workflow = db.workflows.find_one({"run_id": run_id})
    events = list(db.events.find({"run_id": run_id}, {"_id": 0}).sort("seq", 1))
    errors = [e["message"] for e in events if e["t"] == "error"]
    assert run["status"] == "done", f"Live run failed: {errors}"
    assert run["source"] == "live" and run["executor"] == "codex"
    assert len(workflow["states"]) >= 5 and workflow["transitions"]
    assert workflow["checks"] and any(e["t"] == "evidence_searched" for e in events)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["t"] == "run_finished" and events[-1]["status"] == "done"
    assert not any(e["t"] in {"harness_candidate", "gate_result", "gt_scored"} for e in events)
    for event in events:
        if event["t"] == "evidence_searched":
            assert all(r["chunk_id"] in pages for r in event["results"])
    print(json.dumps({"run_id": run_id, "status": run["status"], "events": len(events),
        "states": len(workflow["states"]), "transitions": len(workflow["transitions"]),
        "retrievals": [e["query"] for e in events if e["t"] == "evidence_searched"],
        "checks": [{k: c[k] for k in ("check", "status")} for c in workflow["checks"]]}, indent=2), flush=True)
    print("M12 DONE-WHEN PASSED", flush=True)


if __name__ == "__main__":
    check()
