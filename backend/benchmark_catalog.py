"""Public labels and verifier selection for saved benchmark executions."""

import re


def harness_label(run):
    harness = run["harness_version"]
    # The archive writer appends the first 16 digits of the configuration hash
    # to the job name for database identity. User-defined harness tags stay literal.
    key = (run.get("import_record") or {}).get("archive_key") or ""
    match = re.search(r"/experiments/[^/]+/([0-9a-f]{64})/trials/", key)
    if match and run.get("source") in {"benchmark", "harbor"}:
        return harness.removesuffix("@" + match[1][:16])
    return harness


def current_runs(runs, workflows):
    """Select one score per physical execution and keep independent runs separate."""
    selected = {}
    for run in runs:
        record = run.get("import_record") or {}
        rid = run["run_id"]
        label = harness_label(run)
        key = rid
        if run.get("source") in {"benchmark", "harbor"} and record.get("harbor_run_id"):
            key = (run["protocol_id"], run.get("executor"), run.get("model"), label, record["harbor_run_id"])
        score = workflows.get(rid, {}).get("benchmark_score") or {}
        version = re.fullmatch(r"(?:libgen-)?(\d+)\.(\d+)\.(\d+)", score.get("benchmark_version") or "")
        rank = (bool(score.get("metrics")), tuple(map(int, version.groups())) if version else (),
                bool(record.get("archive_key")), rid)
        if key not in selected or rank > selected[key][0]:
            selected[key] = (rank, {**run, "harness_version": label})
    return [run for _, run in selected.values()]
