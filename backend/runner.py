"""Reconstruct, verify without GT, review failures, then finish the run."""

import logging
from collections.abc import Callable

from db import get_db
from engine import emit
from executor import get_executor
from harness import render
from verifier import verify_run
from reviewer import review_run

logger = logging.getLogger(__name__)


def run_reconstruction(run_id: str, verifier: Callable[[str], None] | None = verify_run,
                       reviewer: Callable[[str], None] | None = review_run, *, evolve: bool = True):
    try:
        run = get_db().runs.find_one({"_id": run_id})
        get_executor(render(run["harness_version"]), executor=run.get("executor")).execute(run_id)
        if verifier is not None:
            verifier(run_id)
        if reviewer is not None:
            reviewer(run_id)
        if evolve:
            from evolver import evolve_and_gate
            evolve_and_gate(run_id)
    except Exception as exc:
        logger.error("Run %s failed: %s", run_id, exc)
        emit(run_id, "error", message=str(exc))
        emit(run_id, "run_finished", status="failed")
    else:
        emit(run_id, "run_finished", status="done")
