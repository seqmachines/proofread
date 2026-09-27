"""Import the original 20 Codex baselines without executing benchmark code.

python -m backend.import_benchmark ../libstruct-bench/runs
python -m backend.import_benchmark --normalize-only
"""

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from uuid import NAMESPACE_URL, uuid5

from pymongo import ReplaceOne, UpdateOne

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_db
from engine import emit
from molecules import BenchmarkScore, MoleculeState, Transition
from seed import BASES, BENCHMARK, convert_ground_truth

RUNS_ROOT = Path(__file__).resolve().parents[2] / "libstruct-bench/runs"
BASELINE_JOB = "libgen/codex/libgen-gpt-5-6-sol"
BASELINE_HARNESS = "benchmark:" + BASELINE_JOB
KEY_FIELDS = ("executor", "model", "harness_version", "protocol_id")


class ImportConflict(ValueError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def identifier(kind, value):
    return uuid5(NAMESPACE_URL, f"proofread:benchmark:{kind}:{value}").hex


def decode(raw):
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


def read_file(path):
    """All benchmark file access passes through the runs/ boundary, including symlinks."""
    path = path.resolve()
    if not path.is_relative_to(RUNS_ROOT.resolve()):
        raise ValueError("Importer reads only ../libstruct-bench/runs/")
    return {"path": path.relative_to(RUNS_ROOT.resolve()).as_posix(),
            "raw": path.read_bytes().decode("utf-8")}


def version_key(version):
    return tuple(int(n) for n in re.findall(r"\d+", version))


def job_label(config, fallback):
    # Use the saved job identifier, not a retry's trial ID or scorer version.
    # Copies in review workspaces therefore still belong to the original system.
    job = str(Path(config["jobs_dir"]) / config["job_name"]) if config.get("jobs_dir") and config.get("job_name") else None
    value = str(config.get("trials_dir") or job or fallback)
    parts = Path(value).parts
    if "runs" in parts:
        value = "/".join(parts[parts.index("runs") + 1:])
    return "benchmark:" + value


def archive_files(path):
    """Prepare the user-selected 20 Codex results and their replay dependencies."""
    path = Path(path).expanduser().resolve(strict=True)
    if not path.is_relative_to(RUNS_ROOT.resolve()):
        raise ValueError("Importer reads only ../libstruct-bench/runs/")
    # The original job summary identifies the first-wave panel. Later waves
    # share its directory, so selecting all Codex files would import 73 trials.
    summary_file = read_file(RUNS_ROOT / BASELINE_JOB / "result.json")
    summary = decode(summary_file["raw"])
    names = {name for evaluation in summary["stats"]["evals"].values()
             for attempts in evaluation["reward_stats"].get("reward", {}).values()
             for name in attempts}
    if summary["n_total_trials"] != 20 or len(names) != 20:
        raise ValueError("The saved Codex baseline panel must identify exactly 20 trials")
    panel = [RUNS_ROOT / BASELINE_JOB / name / "result.json" for name in sorted(names)]
    paths = [p for p in panel if p.is_relative_to(path)] if path.is_dir() else [p for p in panel if p == path]
    if not paths:
        raise ValueError("Path contains none of the selected 20 Codex baselines")
    files = [read_file(p) for p in paths]
    parsed = [decode(f["raw"]) for f in files]
    trials = defaultdict(list)
    for p, result in zip(paths, parsed):
        if result.get("trial_name"):
            trials[result.get("id")].append(p.parent)

    # Ground-truth snapshots are already copied into benchmark review records.
    # Never follow their original task paths outside runs/.
    truths = {}
    for p in sorted(RUNS_ROOT.rglob("groundtruth_library_generation_workflow.json")):
        f = read_file(p)
        data = decode(f["raw"])
        if data.get("protocol_id") and data.get("workflows"):
            versions = re.findall(r"/libgen-(\d+\.\d+\.\d+)/", f["path"])
            rank = (version_key(versions[-1] if versions else "unknown"), f["path"])
            if data["protocol_id"] not in truths or rank > truths[data["protocol_id"]][0]:
                truths[data["protocol_id"]] = (rank, f)

    records = []
    for p, f, result in zip(paths, files, parsed):
        config = result.get("config") or {}
        kind = "trial" if result.get("trial_name") else "aggregate" if result else "malformed"
        config_file = None
        if not config:
            config_path = p.with_name("config.json")
            config_file = read_file(config_path) if config_path.exists() else None
            config = decode(config_file["raw"]) if config_file else {}
        protocol = (result.get("task_id") or config.get("task") or {}).get("path")
        protocol = Path(protocol).name if protocol else None
        if not protocol and kind == "malformed" and "__" in p.parent.name:
            protocol = p.parent.name.split("__", 1)[0]
        agent = config.get("agent") or (config.get("agents") or [{}])[0]
        executor = agent.get("name") or agent.get("import_path") or "unknown"
        model = agent.get("model_name") or "unknown"
        attachments = [summary_file] + ([config_file] if config_file else [])
        directories = trials.get(result.get("id"), [p.parent]) if kind == "trial" else [p.parent]
        if protocol:
            seen = set()
            for folder in directories:
                # Only final artifacts and verifier output. No agent sessions,
                # credentials, trajectories, or benchmark source-code imports.
                candidates = [folder / "artifacts/logs/artifacts/t3_prediction.json",
                              folder / "t3_prediction.json", folder / "verifier_details.json",
                              folder / "reward.json", folder / "error_analysis.json"]
                verifier = folder / "verifier"
                if verifier.is_dir():
                    candidates += [q for q in verifier.rglob("*.json")
                                   if q.name in {"details.json", "reward.json", "error_analysis.json", "error.json"}]
                for q in sorted(candidates):
                    if q.is_file() and q.resolve() not in seen:
                        seen.add(q.resolve())
                        attachments.append(read_file(q))
            if protocol in truths:
                attachments.append(truths[protocol][1])
        record = {"_id": identifier("file", f["path"]), "source_path": f["path"],
                  "raw": f["raw"], "kind": kind, "harbor_run_id": result.get("id", "unknown"),
                  "executor": executor, "model": model,
                  "harness_version": job_label(config, (p.parent.parent if protocol else p.parent).relative_to(RUNS_ROOT).as_posix()),
                  "protocol_id": protocol, "attachments": attachments,
                  "finished_at": result.get("finished_at") or result.get("started_at") or "",
                  "imported_at": datetime.now(timezone.utc).isoformat()}
        selected = score_artifacts(record)
        if selected:
            # The original result remains byte-for-byte. Keep the latest saved
            # rescore's dependencies for normalization, not every old rescore.
            record["attachments"] = [a for a in attachments
                if Path(a["path"]).name in {"result.json", "config.json", "t3_prediction.json", "groundtruth_library_generation_workflow.json"}
                or str(Path(a["path"]).parent) == selected[1]]
        record["scorer_version"] = saved_score(record)["benchmark_version"]
        record["sha256"] = digest({k: v for k, v in record.items() if k != "imported_at"})
        records.append(record)
    if any(r["executor"] != "codex" or r["harness_version"] != BASELINE_HARNESS for r in records):
        raise ValueError("Saved panel contains a non-baseline executor or harness")
    return records


def score_artifacts(record):
    candidates = []
    for f in record["attachments"]:
        if Path(f["path"]).name not in {"details.json", "verifier_details.json"}:
            continue
        data = decode(f["raw"])
        version = data.get("benchmark_version") or data.get("scoring", {}).get("benchmark_version") or "unknown"
        directory = str(Path(f["path"]).parent)
        peers = {Path(a["path"]).name: decode(a["raw"]) for a in record["attachments"]
                 if str(Path(a["path"]).parent) == directory}
        if peers.get("reward.json"):
            candidates.append((version_key(version), directory, version, peers))
    return max(candidates, key=lambda x: x[:2]) if candidates else None


def saved_score(record):
    selected = score_artifacts(record)
    if selected:
        version, metrics = selected[2], selected[3]["reward.json"]
    else:
        version = "unknown"
        metrics = (decode(record["raw"]).get("verifier_result") or {}).get("rewards") or {}
    metrics = {k: v for k, v in metrics.items()
               if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)}
    score = {"benchmark_version": version, "metrics": metrics}
    BenchmarkScore.model_validate(score)
    return score


def prepare_record(record):
    """Pure normalization from one archived document; never opens a file or GT collection."""
    protocol_id = record["protocol_id"]
    if not protocol_id:
        return None  # Job summaries/bundle manifests have no individual protocol.
    files = [(f, decode(f["raw"])) for f in record["attachments"]]
    result = decode(record["raw"])
    issues = []
    graph = {"states": [], "transitions": []}
    predictions = [(f, d) for f, d in files if Path(f["path"]).name == "t3_prediction.json"]
    for f, native in predictions:
        try:
            graph = convert_ground_truth(native, protocol_id, origin="llm", preserve_structure=True)
            for state in graph["states"]:
                MoleculeState.model_validate({k: v for k, v in state.items() if k != "benchmark_structure"})
            for transition in graph["transitions"]:
                Transition.model_validate(transition)
            issues.extend(graph.get("projection_warnings", []))
            break
        except (ValueError, KeyError, TypeError) as exc:
            graph = {"states": [], "transitions": []}
            issues.append(f"Task 3 cannot be projected: {exc}")
    if record["kind"] == "malformed":
        issues.append("Malformed result.json; original text is retained in benchmark_records.")
    if result.get("exception_info"):
        # Exception messages may include paths or credentials. Keep details in
        # the private raw archive; expose only its recorded exception type.
        issues.append("Benchmark attempt failed: " + str(result["exception_info"].get("exception_type", "unknown")))
    truths = [d for f, d in files if Path(f["path"]).name == "groundtruth_library_generation_workflow.json"]
    truth = convert_ground_truth(truths[0], protocol_id, preserve_structure=True) if truths else None
    protocol = {"_id": protocol_id, "id": protocol_id,
                "name": truths[0].get("protocol_name", protocol_id) if truths else protocol_id,
                "family": "unclassified", "role": "dev", "has_gt": truth is not None,
                "source_note": BENCHMARK}
    selected = score_artifacts(record)
    analysis = selected[3].get("error_analysis.json", {}) if selected else {}
    if not analysis:
        analysis = next((d for f, d in files if Path(f["path"]).name == "error_analysis.json"), {})
    checks = []
    state_ids = {s["id"] for s in graph["states"]}
    for observation in analysis.get("observations", []):
        message = (f"{observation.get('error_id', '')} ({observation.get('task', '')}; "
                   f"{observation.get('location', '')}): {observation.get('summary', '')} "
                   f"Attribution: {observation.get('attribution', 'unresolved')}; "
                   f"adjudication: {observation.get('adjudication_status', 'pending')}.")
        check = {"check": observation["category"], "status": "fail",
                 "message": BASES.sub("[sequence omitted]", message), "evidence": []}
        if observation.get("prediction_id") in state_ids:
            check["state_id"] = observation["prediction_id"]
        checks.append(check)
    score = saved_score(record)
    for issue in issues:
        checks.append({"check": "benchmark_import", "status": "fail",
                       "message": BASES.sub("[sequence omitted]", issue), "evidence": []})
    key = tuple(record[k] for k in KEY_FIELDS)
    failed = bool(result.get("exception_info")) or record["kind"] == "malformed" or bool(predictions and not graph["states"])
    content = {"protocol": protocol, "truth": truth, "graph": graph, "checks": checks,
               "score": score, "status": "failed" if failed else "done"}
    return {**content, **{k: record[k] for k in KEY_FIELDS},
            "run_id": identifier("system-protocol", json.dumps(key)),
            "provenance": {"benchmark_record_id": record["_id"], "sha256": digest(content),
                           "model": record["model"], "harbor_run_id": record["harbor_run_id"],
                           "source_path": record["source_path"], "source_note": BENCHMARK}}


def selected_records(records):
    """Latest completed attempt per key; ties prefer the fullest copy, never its score."""
    selected = {}
    for record in records:
        if not record["protocol_id"]:
            continue
        raw = decode(record["raw"])
        rank = (record["kind"] == "trial" and not raw.get("exception_info"),
                record["finished_at"], len(record["attachments"]), record["source_path"])
        key = tuple(record[k] for k in KEY_FIELDS)
        if key not in selected or rank > selected[key][0]:
            selected[key] = (rank, record)
    return [value[1] for key, value in sorted(selected.items())]


def seed_protocols(prepared):
    """Setup-only writes from archived GT; never read the GT collection."""
    db = get_db()
    by_protocol = {r["protocol_id"]: r for r in prepared}
    if not by_protocol:
        return
    db.protocols.bulk_write([UpdateOne({"_id": r["protocol_id"]},
        {"$setOnInsert": {k: v for k, v in r["protocol"].items() if k != "has_gt"},
         **({"$set": {"has_gt": True}} if r["truth"] else {})}, upsert=True)
        for r in by_protocol.values()])
    db.protocols.update_many({"has_gt": {"$exists": False}}, {"$set": {"has_gt": False}})
    truths = [UpdateOne({"protocol_id": r["protocol_id"]},
                       {"$setOnInsert": {**r["truth"], "source_note": BENCHMARK}}, upsert=True)
              for r in by_protocol.values() if r["truth"]]
    if truths:
        db.ground_truth.bulk_write(truths)


def import_record(record):
    """Append a new run or changes to its existing event log after protocol setup."""
    db = get_db()
    run_id = record["run_id"]

    def write(session):
        previous = db.runs.find_one({"_id": run_id}, session=session)
        protocol = record["protocol"]
        if previous and previous.get("source") != "benchmark":
            raise ImportConflict("Import identity collides with a non-benchmark run")
        workflow = db.workflows.find_one({"run_id": run_id}, session=session) if previous else None
        if previous and workflow and previous.get("import_record") == record["provenance"]:
            return False
        if previous and not workflow:
            raise ImportConflict("Existing run has lost its projection; rebuild it from its event log first")
        batch = {"run": previous, "workflow": workflow, "offset": previous["step"],
                 "provenance": record["provenance"]} if previous else {}
        def send(t, **payload):
            return emit(run_id, t, _session=session, _import_batch=batch, **payload)
        if not previous:
            send("run_started", protocol_id=protocol["_id"], harness_version=record["harness_version"],
                 executor=record["executor"], source="benchmark", import_record=record["provenance"])
            for state in record["graph"]["states"]:
                send("state_committed", state=state, workflow_revision=1)
            for transition in record["graph"]["transitions"]:
                send("transition_committed", transition=transition, workflow_revision=1)
        else:
            # Preserve all existing events. Revisions/removals use the same
            # contract as human edits; graph changes remain replayable.
            for key, singular in (("transitions", "transition"), ("states", "state")):
                incoming = {x["id"]: x for x in record["graph"][key]}
                for old in list(workflow[key]):
                    new = incoming.get(old["id"])
                    if old == new:
                        continue
                    payload = {f"{singular}_id": old["id"], "before": old, "after": new,
                               "caused_by": "benchmark_import", "workflow_revision": workflow["workflow_revision"] + 1}
                    if singular == "state":
                        payload["stale"] = []
                    send(f"{singular}_revised", **payload)
            for key, singular in (("states", "state"), ("transitions", "transition")):
                known = {x["id"] for x in workflow[key]}
                for item in record["graph"][key]:
                    if item["id"] not in known:
                        send(f"{singular}_committed", **{singular: item}, workflow_revision=workflow["workflow_revision"])
        for check in record["checks"]:
            if check not in batch["workflow"]["checks"]:
                send("verifier_check", **check)
        send("benchmark_scored", **record["score"])
        send("run_finished", status=record["status"])
        return True

    with db.client.start_session() as session:
        return session.with_transaction(write)


def normalize_records():
    """Replay exclusively from benchmark_records; also works without the checkout."""
    selected = selected_records(get_db().benchmark_records.find({
        "executor": "codex", "harness_version": BASELINE_HARNESS,
        "source_path": {"$regex": "^" + re.escape(BASELINE_JOB) + r"/[^/]+/result\.json$"},
    }))
    prepared = [prepare_record(record) for record in selected]
    seed_protocols(prepared)
    with ThreadPoolExecutor(max_workers=4) as pool:
        return sum(pool.map(import_record, prepared))


def store_records(records):
    db = get_db()
    # Keep one archival document for each selected baseline result file.
    existing = {r["_id"]: r["sha256"] for r in db.benchmark_records.find({}, {"sha256": 1})}
    changed = [r for r in records if existing.get(r["_id"]) != r["sha256"]]
    if changed:
        db.benchmark_records.bulk_write([ReplaceOne({"_id": r["_id"]}, r, upsert=True) for r in changed])
    return len(changed)


def import_benchmark(path, *, source="benchmark"):
    if source != "benchmark":
        raise NotImplementedError("Harbor trajectory import is M14; use source=benchmark for saved records")
    count = store_records(archive_files(path))
    return {"records": count, "runs": normalize_records()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, nargs="?", default=RUNS_ROOT)
    parser.add_argument("--source", choices=("benchmark", "harbor"), default="benchmark")
    parser.add_argument("--normalize-only", action="store_true")
    args = parser.parse_args()
    result = {"records": 0, "runs": normalize_records()} if args.normalize_only else import_benchmark(args.path, source=args.source)
    print(json.dumps(result))
