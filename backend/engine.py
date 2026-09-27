"""Run snapshots and their append-only event log. All run writes use emit()."""

from datetime import datetime, timezone
import os
from uuid import uuid4

from pymongo import ReturnDocument, UpdateOne

from db import get_db


def create_run(protocol_id: str, harness_version: str = "v0", *, executor: str | None = None) -> str:
    run_id = uuid4().hex
    emit(run_id, "run_started", protocol_id=protocol_id, harness_version=harness_version,
         executor=executor or os.getenv("EXECUTOR", "codex"), source="live")
    return run_id


def emit(run_id: str, t: str, *, drained_inbox: list | None = None,
         signal_document: dict | None = None, harness_document: dict | None = None,
         gate_evaluation: dict | None = None, import_record: dict | None = None,
         review_flags: dict | None = None, _review_revision: int | None = None,
         _session=None, _import_batch=None, **payload) -> dict:
    if _review_revision is not None and _session is None:
        raise ValueError("Review revisions require an enclosing transaction")
    if review_flags is not None and (t != "review_recorded" or
            set(review_flags) - {"verified_through_revision", "gt_candidate"}):
        raise ValueError("Review flags belong to review_recorded")
    if {"seq", "ts", "_id"} & payload.keys():
        raise ValueError("Event headers are assigned by emit()")
    if t == "run_finished" and payload.get("status") not in {"done", "failed"}:
        raise ValueError("run_finished status must be done or failed")
    if t == "run_started":
        payload.setdefault("source", "live")
        payload.setdefault("executor", os.getenv("EXECUTOR", "codex"))
        if payload["source"] not in {"live", "benchmark", "harbor"}:
            raise ValueError("Unknown run source")
    if import_record is not None and (t != "run_started" or payload["source"] == "live"):
        raise ValueError("Import provenance belongs to an imported run_started")
    if t == "benchmark_scored":
        from tool_models import BenchmarkScore
        BenchmarkScore.model_validate(payload)
    if t == "review_finding" or (t == "human_message" and signal_document is not None):
        from review_models import Signal
        if signal_document is None:
            raise ValueError("review_finding needs its signal document")
        signal = Signal.model_validate(signal_document)
        if signal.run_id != run_id:
            raise ValueError("Signal must belong to this run")
        if t == "human_message" and (signal.source != "human" or not signal.systematic):
            raise ValueError("A human harness request needs a systematic human signal")
        if t == "review_finding" and (signal.id != payload.get("signal_id") or any(
                getattr(signal, k) != payload.get(k) for k in
                ("operation", "state_id", "root_cause", "recommended_action", "harness_relevance"))):
            raise ValueError("Review event must match its signal")
    elif signal_document is not None:
        raise ValueError("Only a review finding or human harness request may write a signal")
    if (t == "harness_candidate") != (harness_document is not None):
        raise ValueError("harness_candidate needs its version document")
    if (t == "gate_result") != (gate_evaluation is not None):
        raise ValueError("gate_result needs its evaluation")
    if t == "harness_promoted":
        raise ValueError("Promotion is emitted atomically with a passing gate_result")
    if _import_batch is not None:
        return _emit_import(run_id, t, payload, import_record, _import_batch, _session)
    db = get_db()

    def write(session):
        ts = datetime.now(timezone.utc).isoformat()
        query = {"_id": run_id}
        update = {"$inc": {"step": 1}}
        if t == "run_started":
            query["step"] = {"$exists": False}
            update["$setOnInsert"] = {
                "run_id": run_id, "protocol_id": payload["protocol_id"],
                "harness_version": payload["harness_version"], "status": "running",
                "source": payload["source"], "executor": payload["executor"], "parent_run_id": None,
                "model": os.getenv("CODEX_MODEL", "unknown") if payload["executor"] == "codex" else "unknown",
                "verified_through_revision": None,
                "checkpoint": {}, "tokens": {"last_call": 0, "cumulative": 0},
                "inbox": [], "created_at": ts,
            }
            if import_record is not None:
                update["$setOnInsert"]["import_record"] = import_record
        elif t == "run_finished":
            update["$set"] = {"status": payload["status"]}
        elif t == "checkpoint":
            update["$set"] = {"checkpoint": payload, "tokens": payload["tokens"]}
        elif t == "verifier_check":
            if payload.get("status") not in {"pass", "fail"}:
                raise ValueError("verifier_check status must be pass or fail")
            update["$set"] = {"status": "reviewing"}
        elif t in {"review_finding", "harness_candidate", "gate_result"}:
            update["$set"] = {"status": "reviewing"}
        elif t == "review_recorded" and review_flags is not None:
            update["$set"] = review_flags
        if drained_inbox:
            update["$pull"] = {"inbox": {"$in": drained_inbox}}

        run = db.runs.find_one_and_update(
            query, update, upsert=t == "run_started",
            return_document=ReturnDocument.AFTER, session=session,
        )
        if run is None:
            raise ValueError(f"Unknown run: {run_id}")
        event = {"run_id": run_id, "seq": run["step"], "ts": ts, "t": t, **payload}
        # The transaction prevents a failed insert from consuming a sequence
        # number, and makes the snapshot visible with its corresponding event.
        db.events.insert_one(dict(event), session=session)
        if t == "harness_candidate":
            from harness_changes import validate_candidate
            parents = list(db.harness_versions.find({"status": "active"}, session=session))
            if len(parents) != 1:
                raise ValueError("Expected exactly one active harness")
            validate_candidate(harness_document, parents[0])
            if payload != {"version": harness_document["_id"], "parent": parents[0]["_id"],
                           "patches": harness_document["patches"]}:
                raise ValueError("Candidate event must match its document")
            if db.harness_versions.find_one({"status": "candidate"}, session=session):
                raise ValueError("Evaluate the existing candidate before creating another")
            for signal_id in harness_document["source_signals"]:
                result = db.signals.update_one({"_id": signal_id, "run_id": run_id, "processed": False,
                    "$or": [{"harness_relevance": "high", "proposed_patch": {"$ne": None}},
                            {"source": "human", "systematic": True}]},
                    {"$set": {"processed": True}}, session=session)
                if result.matched_count != 1:
                    raise ValueError("Candidate source signal is missing, ineligible, or already processed")
            db.harness_versions.insert_one(dict(harness_document), session=session)
        elif t == "gate_result":
            from harness_changes import gate_payload
            if payload != gate_payload(payload["version"], gate_evaluation):
                raise ValueError("Gate event must match its evaluation")
            candidate = db.harness_versions.find_one({"_id": payload["version"], "status": "candidate"}, session=session)
            source = db.events.find_one({"run_id": run_id, "t": "harness_candidate", "version": payload["version"]}, session=session)
            if candidate is None or candidate["eval"] is not None or source is None:
                raise ValueError("Gate needs an unevaluated candidate belonging to this triggering run")
            db.harness_versions.update_one({"_id": candidate["_id"]}, {"$set": {
                "eval": gate_evaluation, "status": "rejected" if payload["decision"] == "reject" else "candidate",
            }}, session=session)
            if payload["decision"] == "promote":
                active = list(db.harness_versions.find({"status": "active"}, session=session))
                if len(active) != 1 or active[0]["_id"] != candidate["parent_id"]:
                    raise ValueError("Active parent changed during Gate evaluation")
                result = db.harness_versions.bulk_write([
                    UpdateOne({"_id": candidate["parent_id"], "status": "active"}, {"$set": {"status": "superseded"}}),
                    UpdateOne({"_id": candidate["_id"], "status": "candidate"}, {"$set": {"status": "active"}}),
                ], session=session)
                if result.matched_count != 2:
                    raise ValueError("Promotion lost its active parent")
                promoted_run = db.runs.find_one_and_update({"_id": run_id}, {"$inc": {"step": 1}},
                    return_document=ReturnDocument.AFTER, session=session)
                db.events.insert_one({"run_id": run_id, "seq": promoted_run["step"], "ts": ts,
                    "t": "harness_promoted", "version": candidate["_id"]}, session=session)
        if t == "human_message" and signal_document is not None:
            if signal.protocol_id != run["protocol_id"] or signal.harness_version != run["harness_version"]:
                raise ValueError("Human signal must belong to this run's protocol and harness")
            db.signals.insert_one(dict(signal_document), session=session)
        if t == "review_finding":
            if signal.protocol_id != run["protocol_id"] or signal.harness_version != run["harness_version"]:
                raise ValueError("Signal must belong to this run's protocol and harness")
            # A deliberate re-review can correct a pending reviewer signal;
            # its earlier finding stays in the append-only event history.
            db.signals.replace_one({"_id": signal.id, "run_id": run_id,
                                    "source": "reviewer", "processed": False, "systematic": False},
                                   dict(signal_document), upsert=True, session=session)
        if t == "run_started":
            db.workflows.insert_one({
                "run_id": run_id, "protocol_id": payload["protocol_id"],
                "harness_version": payload["harness_version"], "workflow_revision": 1,
                "states": [], "transitions": [], "checks": [], "gt_score": None,
            }, session=session)
        elif t in {"state_committed", "transition_committed"}:
            key = "state" if t == "state_committed" else "transition"
            result = db.workflows.update_one(
                {"run_id": run_id, "workflow_revision": payload["workflow_revision"],
                 f"{key}s.id": {"$ne": payload[key]["id"]}},
                {"$push": {f"{key}s": payload[key]}}, session=session,
            )
            if result.matched_count != 1:
                raise ValueError("Missing workflow, stale revision, or duplicate state/transition ID")
        elif t == "state_revised":
            workflow = db.workflows.find_one({"run_id": run_id}, session=session)
            if (workflow["workflow_revision"] + 1 != payload["workflow_revision"] and not
                (_review_revision == payload["workflow_revision"] == workflow["workflow_revision"])):
                raise ValueError("Stale workflow revision")
            current = next((s for s in workflow["states"] if s["id"] == payload["state_id"]), None)
            if current is None or current != payload["before"]:
                raise ValueError("State changed before revision could be applied")
            states = [payload["after"] if s["id"] == payload["state_id"] else
                      {**s, "stale_since_revision": payload["workflow_revision"]}
                      if s["id"] in payload["stale"] else s for s in workflow["states"]
                      if s["id"] != payload["state_id"] or payload["after"] is not None]
            db.workflows.update_one({"run_id": run_id}, {"$set": {
                "states": states, "workflow_revision": payload["workflow_revision"],
            }}, session=session)
        elif t == "transition_revised":
            workflow = db.workflows.find_one({"run_id": run_id}, session=session)
            if (workflow["workflow_revision"] + 1 != payload["workflow_revision"] and not
                (_review_revision == payload["workflow_revision"] == workflow["workflow_revision"])):
                raise ValueError("Stale workflow revision")
            current = next((x for x in workflow["transitions"] if x["id"] == payload["transition_id"]), None)
            if current != payload["before"]:
                raise ValueError("Transition changed before revision could be applied")
            transitions = [payload["after"] if x["id"] == payload["transition_id"] else x
                           for x in workflow["transitions"]
                           if x["id"] != payload["transition_id"] or payload["after"] is not None]
            if current is None and payload["after"] is not None:
                transitions.append(payload["after"])
            db.workflows.update_one({"run_id": run_id}, {"$set": {
                "transitions": transitions, "workflow_revision": payload["workflow_revision"],
            }}, session=session)
        elif t == "review_recorded":
            status = {"accept": "accepted", "modify": "modified", "reject": "rejected", "unresolved": "unresolved"}[payload["decision"]]
            db.workflows.update_one({"run_id": run_id, "states.id": payload["target_id"]},
                                   {"$set": {"states.$.review_status": status}}, session=session)
        elif t == "verifier_check":
            db.workflows.update_one({"run_id": run_id}, {"$push": {"checks": payload}}, session=session)
        elif t == "gt_scored":
            if set(payload) != {"structure_f1", "edge_f1"} or not all(
                    isinstance(x, (int, float)) and 0 <= x <= 1 for x in payload.values()):
                raise ValueError("gt_scored requires structure_f1 and edge_f1 in [0, 1]")
            db.workflows.update_one({"run_id": run_id}, {"$set": {"gt_score": payload}}, session=session)
            if _review_revision is None and run["harness_version"] == "v0" and run.get("source", "live") == "live":
                db.runs.update_one({"_id": run_id}, {"$set": {"baseline": True}}, session=session)
        elif t == "benchmark_scored":
            if run.get("source") not in {"benchmark", "harbor"}:
                raise ValueError("Benchmark scores belong to imported runs")
            db.workflows.update_one({"run_id": run_id}, {"$set": {"benchmark_score": payload}}, session=session)
        return event

    if _session is not None:
        return write(_session)
    with db.client.start_session() as session:
        return session.with_transaction(write)


def _emit_import(run_id, t, payload, provenance, batch, session):
    """Buffer imported events; commit their log and fold at run_finished.

    Per-event round trips exceed Atlas's transaction lifetime for large records.
    Only this small set of import events can use the batch path; live writes
    retain emit's normal transactional projection above.
    """
    if session is None or not session.in_transaction:
        raise ValueError("Import batches require an enclosing transaction")
    events = batch.setdefault("events", [])
    if t == "run_started":
        if events or payload["source"] != "benchmark" or provenance is None:
            raise ValueError("Import batch must start once with benchmark provenance")
        batch["run"] = {"_id": run_id, "run_id": run_id, **payload,
                        "status": "running", "checkpoint": {}, "inbox": [],
                        "tokens": {"last_call": 0, "cumulative": 0},
                        "parent_run_id": None, "verified_through_revision": None,
                        "model": provenance["model"],
                        "benchmark_record_id": provenance["benchmark_record_id"],
                        "import_record": provenance}
        batch["workflow"] = {"run_id": run_id, "protocol_id": payload["protocol_id"],
            "harness_version": payload["harness_version"], "workflow_revision": 1,
            "states": [], "transitions": [], "checks": [], "gt_score": None}
    elif (not batch.get("run") or batch["run"]["run_id"] != run_id
          or (events and events[-1]["t"] == "run_finished")):
        raise ValueError("Import event must belong to its unfinished batch")
    workflow = batch["workflow"]
    if t in {"state_committed", "transition_committed"}:
        key = "state" if t == "state_committed" else "transition"
        item = payload[key]
        if payload["workflow_revision"] != workflow["workflow_revision"] or any(x["id"] == item["id"] for x in workflow[key + "s"]):
            raise ValueError("Invalid imported revision or duplicate ID")
        workflow[key + "s"].append(item)
    elif t in {"state_revised", "transition_revised"}:
        key = "state" if t == "state_revised" else "transition"
        current = next((x for x in workflow[key + "s"] if x["id"] == payload[key + "_id"]), None)
        if current != payload["before"] or payload["workflow_revision"] != workflow["workflow_revision"] + 1:
            raise ValueError("Stale imported revision")
        workflow[key + "s"] = [payload["after"] if x["id"] == payload[key + "_id"] else x
                               for x in workflow[key + "s"]
                               if x["id"] != payload[key + "_id"] or payload["after"] is not None]
        workflow["workflow_revision"] = payload["workflow_revision"]
    elif t == "verifier_check":
        if payload["status"] not in {"pass", "fail"}:
            raise ValueError("Invalid imported check status")
        workflow["checks"].append(payload)
    elif t == "benchmark_scored":
        if any(e["t"] == "benchmark_scored" for e in events):
            raise ValueError("An import carries one saved benchmark score")
        workflow["benchmark_score"] = payload
    elif t == "run_finished":
        if "benchmark_score" not in workflow:
            raise ValueError("An imported record must have its saved scores")
        batch["run"]["status"] = payload["status"]
    elif t != "run_started":
        raise ValueError(f"Not a benchmark record event: {t}")
    event = {"run_id": run_id, "seq": batch.get("offset", 0) + len(events) + 1,
             "ts": datetime.now(timezone.utc).isoformat(), "t": t, **payload}
    events.append(event)
    if t == "run_finished":
        db = get_db()
        batch["run"]["step"] = event["seq"]
        if batch.get("offset"):
            provenance = batch["provenance"]
            batch["run"].update(import_record=provenance, model=provenance["model"],
                                benchmark_record_id=provenance["benchmark_record_id"])
            result = db.runs.replace_one({"_id": run_id, "step": batch["offset"]}, dict(batch["run"]), session=session)
            if result.matched_count != 1:
                raise ValueError("Run changed during import")
            db.workflows.replace_one({"run_id": run_id}, dict(workflow), session=session)
        else:
            batch["run"]["created_at"] = events[0]["ts"]
            db.runs.insert_one(dict(batch["run"]), session=session)
            db.workflows.insert_one(dict(workflow), session=session)
        db.events.insert_many([dict(e) for e in events], session=session)
    return event


def checkpoint(run_id: str, pending: list[str] | None = None,
               tokens: dict | None = None, drained_inbox: list | None = None) -> dict:
    db = get_db()
    run = db.runs.find_one({"_id": run_id})
    workflow = db.workflows.find_one({"run_id": run_id})
    if run is None or workflow is None:
        raise ValueError(f"Unknown run: {run_id}")
    return emit(run_id, "checkpoint", completed_states=[s["id"] for s in workflow["states"]],
                pending=pending or [], tokens=tokens if tokens is not None else run["tokens"],
                drained_inbox=drained_inbox)
