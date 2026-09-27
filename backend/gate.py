"""Isolated GT scoring and M7 candidate evaluation against stored v0 baselines."""

from concurrent.futures import ThreadPoolExecutor
from statistics import mean

from db import get_db
from engine import create_run, emit
from harness_changes import gate_payload
from verifier import compare_ground_truth, verify_run


def evaluate_existing(run_id):
    db = get_db()
    run = db.runs.find_one({"_id": run_id})
    if run is None:
        raise ValueError(f"Unknown run: {run_id}")
    if run["status"] not in {"done", "failed", "reviewing"}:
        raise ValueError("Wait for reconstruction to finish before scoring it")
    # Read/score first so absent GT cannot leave a completed run reviewing.
    report = compare_ground_truth(run_id)
    last_score = db.events.find_one({"run_id": run_id, "t": "gt_scored"}, sort=[("seq", -1)])
    changed = db.events.find_one({"run_id": run_id, "t": {"$in": [
        "state_committed", "transition_committed", "state_revised"]},
        "seq": {"$gt": last_score["seq"] if last_score else 0}})
    workflow = db.workflows.find_one({"run_id": run_id})
    if last_score and not changed and run["status"] in {"done", "failed"} and workflow["gt_score"] == report["scores"]:
        report["checks"] = workflow["checks"]
        return report
    try:
        report["checks"] = verify_run(run_id)
        emit(run_id, "gt_scored", **report["scores"])
    except Exception as exc:
        emit(run_id, "error", message=f"Verification failed: {exc}")
        emit(run_id, "run_finished", status="failed")
        raise
    # A retroactive pass appends its events after the old M3 completion. The
    # latest event is terminal; the original append-only history is preserved.
    emit(run_id, "run_finished", status="failed" if run["status"] == "failed" else "done")
    return report


def baseline_runs(trigger_id):
    db = get_db()
    trigger = db.runs.find_one({"_id": trigger_id})
    target = db.protocols.find_one({"_id": trigger["protocol_id"]})
    regressions = list(db.protocols.find({"role": "regression", "_id": {"$ne": target["_id"]}}).sort("_id", 1))
    if len(regressions) != 2 or any(p["family"] == target["family"] for p in regressions):
        raise ValueError("Gate requires two regression protocols outside the target family")
    rows = []
    for protocol in [target, *regressions]:
        if protocol["_id"] == trigger["protocol_id"] and trigger["harness_version"] == "v0":
            baseline = trigger
            if baseline["status"] not in {"done", "reviewing"}:
                raise ValueError("Target baseline reconstruction did not finish successfully")
            evaluate_existing(trigger_id)
        else:
            baseline = db.runs.find_one({"protocol_id": protocol["_id"], "harness_version": "v0",
                                         "baseline": True, "status": "done"}, sort=[("created_at", 1)])
        if baseline is None:
            raise ValueError(f"Missing completed v0 baseline for {protocol['_id']}")
        workflow = db.workflows.find_one({"run_id": baseline["_id"]})
        if not workflow or workflow["gt_score"] is None:
            raise ValueError(f"Score v0 baseline {baseline['_id']} before gating")
        rows.append({"protocol_id": protocol["_id"], "baseline_run_id": baseline["_id"],
                     "role": "target" if not rows else "regression",
                     "before": workflow["gt_score"]["structure_f1"]})
    return rows


def _evaluate_protocol(version, baseline):
    from runner import run_reconstruction
    db = get_db()
    prior = list(db.runs.find({"harness_version": version, "protocol_id": baseline["protocol_id"]}))
    if len(prior) > 1:
        raise ValueError("Multiple candidate runs exist; refusing to choose a favorable result")
    if prior:
        run_id = prior[0]["_id"]
        if prior[0]["status"] not in {"done", "failed"}:
            raise ValueError(f"Candidate run {run_id} is still in progress")
    else:
        run_id = create_run(baseline["protocol_id"], version)
        # Review normally, but never evolve Gate-generated signals recursively.
        run_reconstruction(run_id, evolve=False)
    score = evaluate_existing(run_id)["scores"]["structure_f1"]
    run = db.runs.find_one({"_id": run_id})
    return {**baseline, "run_id": run_id, "status": run["status"], "after": score,
            "delta": round(score - baseline["before"], 6)}


def collect_candidate(version, *, target_runs=2):
    """Collect the requested measurements without making a promotion decision."""
    from evolver import EVOLUTION_LOCK
    from runner import run_reconstruction
    with EVOLUTION_LOCK:
        db = get_db()
        candidate = db.harness_versions.find_one({"_id": version, "status": "candidate", "eval": None})
        event = db.events.find_one({"t": "harness_candidate", "version": version})
        if candidate is None or event is None:
            raise ValueError("Collect measurements for an unevaluated candidate")
        plan = []
        for baseline in baseline_runs(event["run_id"]):
            count = target_runs if baseline["role"] == "target" else 1
            prior = list(db.runs.find({"harness_version": version, "protocol_id": baseline["protocol_id"]}).sort("created_at", 1))
            if len(prior) > count or any(r["status"] not in {"done", "failed"} for r in prior):
                raise ValueError("Unexpected extra or in-progress candidate runs; refusing to select or duplicate results")
            plan.extend((baseline, prior[i]["_id"] if i < len(prior) else None) for i in range(count))

        def measure(item):
            baseline, run_id = item
            if run_id is None:
                run_id = create_run(baseline["protocol_id"], version)
                run_reconstruction(run_id, evolve=False)
            scores = evaluate_existing(run_id)["scores"]
            run = db.runs.find_one({"_id": run_id})
            return {**baseline, "run_id": run_id, "status": run["status"], "after": scores["structure_f1"],
                    "delta": round(scores["structure_f1"] - baseline["before"], 6)}

        with ThreadPoolExecutor(max_workers=len(plan)) as pool:
            return list(pool.map(measure, plan))


def summarize_measurements(measurements):
    """One event row per protocol, retaining every replicate in its evaluation."""
    groups = {}
    for measurement in measurements:
        groups.setdefault(measurement["protocol_id"], []).append(measurement)
    rows = []
    for samples in groups.values():
        first = samples[0]
        if any((s["before"], s["baseline_run_id"], s["role"]) !=
               (first["before"], first["baseline_run_id"], first["role"]) for s in samples):
            raise ValueError("Replicates must use the same preselected baseline and role")
        after = round(mean(s["after"] for s in samples), 6)
        rows.append({k: first[k] for k in ("protocol_id", "role", "baseline_run_id", "before")})
        rows[-1].update(after=after, delta=round(after - first["before"], 6),
                        status="done" if all(s["status"] == "done" for s in samples) else "failed",
                        run_ids=[s["run_id"] for s in samples], scores=[s["after"] for s in samples],
                        run_statuses=[s["status"] for s in samples])
    return rows


def gate_candidate(version):
    from evolver import EVOLUTION_LOCK
    with EVOLUTION_LOCK:
        db = get_db()
        candidate = db.harness_versions.find_one({"_id": version})
        if candidate is None:
            raise ValueError(f"Unknown harness version: {version}")
        if candidate["eval"] is not None:
            return gate_payload(version, candidate["eval"])
        if candidate["status"] != "candidate":
            raise ValueError("Only candidate harness versions can enter the Gate")
        event = db.events.find_one({"t": "harness_candidate", "version": version})
        if event is None:
            raise ValueError("Candidate has no triggering event")
        baselines = baseline_runs(event["run_id"])
        # The protocols are independent; candidates themselves remain sequential.
        with ThreadPoolExecutor(max_workers=3) as pool:
            rows = list(pool.map(lambda row: _evaluate_protocol(version, row), baselines))
        failures = [r["run_id"] for r in rows if r["status"] != "done"]
        reasons = []
        if failures:
            reasons.append("Failed candidate runs: " + ", ".join(failures))
        if rows[0]["delta"] < 0.05:
            reasons.append(f"Target structure_f1 delta {rows[0]['delta']:+.6f} is below +0.050000")
        minimum = min(r["delta"] for r in rows[1:])
        if minimum < -0.02:
            reasons.append(f"Minimum regression structure_f1 delta {minimum:+.6f} is below -0.020000")
        active = db.harness_versions.find_one({"status": "active"})
        if active is None or active["_id"] != candidate["parent_id"]:
            reasons.append("Active parent changed during evaluation")
        evaluation = {"target": rows[0], "regression": rows[1:],
                      "decision": "reject" if reasons else "promote",
                      "reason": "; ".join(reasons) if reasons else
                      "Target structure_f1 improves by at least +0.05; both regression deltas are at least -0.02"}
        payload = gate_payload(version, evaluation)
        # emit projects the evaluation, bulk promotion, and promotion event in
        # one transaction. A crash cannot publish a result without its status.
        emit(event["run_id"], "gate_result", gate_evaluation=evaluation, **payload)
        return payload


def gate_and_finish(version):
    """Background/manual API completion; keep the triggering log terminal."""
    db = get_db()
    event = db.events.find_one({"t": "harness_candidate", "version": version})
    if event is None:
        raise ValueError("Candidate has no triggering event")
    run_id = event["run_id"]
    previous = db.events.find_one({"run_id": run_id, "t": "run_finished"}, sort=[("seq", -1)])
    try:
        result = gate_candidate(version)
    except Exception as exc:
        emit(run_id, "error", message=f"Gate failed: {exc}")
        emit(run_id, "run_finished", status="failed")
        raise
    last = db.events.find_one({"run_id": run_id}, sort=[("seq", -1)])
    if last["t"] != "run_finished":
        emit(run_id, "run_finished", status=previous["status"] if previous else "done")
    return result
