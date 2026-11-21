"""Offline regression for verifier selection and archive labels in Proofread."""

from copy import deepcopy

from benchmark_catalog import current_runs, harness_label
from verifier_text import public_event


def check():
    config = "23" * 32
    base = "benchmark:libgen/codex/baseline"
    archive = f"libstructbench/experiments/baseline/{config}/trials/a/b/manifest.json"
    original = {"run_id": "paper", "source": "benchmark", "protocol_id": "p", "model": "m",
                "executor": "codex", "harness_version": base, "import_record": {"harbor_run_id": "attempt"}}
    saved = {**original, "run_id": "saved", "harness_version": base + "@" + config[:16],
             "import_record": {**original["import_record"], "archive_key": archive}}
    retry = {**saved, "run_id": "retry", "import_record": {**saved["import_record"], "harbor_run_id": "attempt2"}}
    custom = {**saved, "run_id": "custom", "harness_version": base + "@different"}
    live = {**saved, "run_id": "live", "source": "live"}
    inputs = [original, saved, retry, custom, live]
    before = deepcopy(inputs)
    def score(version):
        return {"benchmark_score": {"benchmark_version": version, "metrics": {"reward": 0.5}}}

    scores = {"paper": score("4.7.0"), "saved": score("4.10.0")}
    for order in (inputs, reversed(inputs)):
        selected = {run["run_id"]: run for run in current_runs(order, scores)}
        assert set(selected) == {"saved", "retry", "custom", "live"}
        assert selected["saved"]["harness_version"] == selected["retry"]["harness_version"] == base
        assert selected["custom"] == custom and selected["live"] == live
    assert current_runs([original, saved], {"paper": score("4.10.0"), "saved": score("4.7.0")}) == [original]
    assert current_runs([original, saved], {"paper": score("4.7.0")}) == [original]
    assert inputs == before
    event = {"t": "run_started", "harness_version": saved["harness_version"]}
    assert public_event(event, harness_label(saved))["harness_version"] == base
    assert event["harness_version"] == saved["harness_version"]


if __name__ == "__main__":
    check()
    print("Benchmark catalog regression passed")
