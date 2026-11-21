"""Publish approved, checksum-verified workflow review details. Dry run by default."""

import argparse
import json
import re
from collections import Counter
from pathlib import Path

from db import get_db
from engine import emit
from pymongo.errors import DuplicateKeyError
from seed import BASES, convert_ground_truth
from verifier import compare_workflow


def ensure_link(db, run, name, session):
    existing = db.run_links.find_one({"run_id": run["run_id"]}, session=session)
    if existing:
        return existing["_id"]
    base = re.sub(r"[^a-z0-9_.-]+", "-", name.lower()).strip("-")
    model = re.sub(r"[^a-z0-9.-]+", "-", run.get("model", "agent").lower()).strip("-")
    suffix = 1
    slug = base
    while db.run_links.find_one({"_id": slug}, {"_id": 1}, session=session):
        suffix += 1
        slug = f"{base}-{model}" if suffix == 2 else f"{base}-{model}-{suffix}"
    db.run_links.insert_one({"_id": slug, "run_id": run["run_id"]}, session=session)
    return slug


def process(row, apply):
    db = get_db()
    pid = row["protocol_id"]
    run = db.runs.find_one({"import_record.sha256": row["snapshot"], "protocol_id": pid, "source": "benchmark"})
    if not run or run["status"] != "done":
        raise ValueError(f"No matching completed publication for {pid}")
    rid = run["run_id"]
    archive_id = run["benchmark_record_id"]
    wf = db.workflows.find_one({"run_id": rid})
    if wf["benchmark_score"] != {"benchmark_version": row["version"], "metrics": row["metrics"]}:
        raise ValueError(f"Published scores differ for {pid}")
    marker = {"reference_sha256": row["truth_sha256"], "details_sha256": row["details_sha256"],
              "snapshot_sha256": row["snapshot"], "verifier": row["version"]}
    def recorded(session=None):
        return db.benchmark_records.find_one({"_id": archive_id, **{
            f"review_publication.{k}": v for k, v in marker.items()}}, {"_id": 1}, session=session)
    if recorded():
        return "already published"
    reference = convert_ground_truth(row["truth"], pid, preserve_structure=True)
    comparison = compare_workflow(wf, reference)
    states = {s["id"] for s in wf["states"]}
    checks = []
    for obs in row["observations"]:
        check = {"check": obs["category"], "status": "fail",
                 "message": BASES.sub("[sequence omitted]", obs["summary"]), "evidence": []}
        if obs.get("prediction_id") in states:
            check["state_id"] = obs["prediction_id"]
        checks.append(check)
    if not checks:
        checks.append({"check": "benchmark_findings", "status": "pass",
                       "message": "The saved verifier analysis recorded no discrepancies.", "evidence": []})
    if not apply:
        return "ready"

    def write(session):
        if recorded(session):
            return "already published"
        current = db.runs.find_one({"_id": rid}, session=session)
        if current["step"] != run["step"] or current["import_record"] != run["import_record"]:
            raise ValueError(f"Run changed during comparison for {pid}; retry")
        db.ground_truth_versions.update_one({"_id": row["truth_sha256"]},
            {"$setOnInsert": reference}, upsert=True, session=session)
        db.ground_truth.update_one({"protocol_id": pid}, {"$setOnInsert": reference}, upsert=True, session=session)
        db.protocols.update_one({"_id": pid}, {"$set": {"has_gt": True}}, session=session)
        base = f"{pid}-{run['executor']}"
        slug = ensure_link(db, run, base, session)
        db.run_links.update_one({"_id": slug}, {"$set": {"reference_sha256": row["truth_sha256"]}}, session=session)
        # Old bookmarks remain tied to their own run and reviews.
        old = db.runs.find({"protocol_id": pid, "import_record.harbor_run_id": run["import_record"]["harbor_run_id"],
                            "executor": run["executor"], "model": run["model"],
                            "source": "benchmark", "import_record.archive_key": {"$exists": False}}, session=session)
        for earlier in old:
            old_wf = db.workflows.find_one({"run_id": earlier["run_id"]}, {"benchmark_score": 1}, session=session)
            version = ((old_wf or {}).get("benchmark_score") or {}).get("benchmark_version") or "archived"
            ensure_link(db, earlier, f"{base}-v{version}", session)
        for check in checks:
            emit(rid, "verifier_check", _session=session, **check)
        emit(rid, "gt_scored", _session=session, **comparison["scores"])
        last = emit(rid, "run_finished", status=current["status"], _session=session)
        updated = db.benchmark_records.update_one({"_id": archive_id, "review_publication": {"$exists": False}},
            {"$set": {"review_publication": {**marker, "step": last["seq"], "diff": comparison["diff"],
                                             "checks": checks}}}, session=session)
        if updated.modified_count != 1:
            raise ValueError(f"Conflicting review publication for {pid}")
        return "published"

    with db.client.start_session() as session:
        for attempt in range(3):
            try:
                return session.with_transaction(write)
            except DuplicateKeyError:
                if attempt == 2:
                    raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply:
        get_db().run_links.create_index("run_id", unique=True)
    counts = Counter()
    with args.file.open() as stream:
        for line in stream:
            row = json.loads(line)
            status = process(row, args.apply)
            counts[status] += 1
            print(row["protocol_id"], status, flush=True)
    print(dict(counts))


if __name__ == "__main__":
    main()
