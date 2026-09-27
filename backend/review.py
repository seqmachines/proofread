"""Review an existing verified run: python -m backend.review RUN_ID."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_db
from engine import emit
from reviewer import review_run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--force", action="store_true", help="Re-review and append corrected findings for pending signals")
    args = parser.parse_args()
    run = get_db().runs.find_one({"_id": args.run_id})
    if run is None or run["status"] not in {"done", "failed", "reviewing"}:
        parser.exit(1, "Run must exist and have finished reconstruction\n")
    workflow = get_db().workflows.find_one({"run_id": args.run_id})
    if not workflow or not workflow["checks"]:
        parser.exit(1, "Run the verifier before reviewing an existing run\n")
    try:
        signals = review_run(args.run_id, force=args.force)
    except Exception as exc:
        emit(args.run_id, "error", message=f"Review failed ({type(exc).__name__}); no automatic repair applied")
        emit(args.run_id, "run_finished", status="failed")
        raise
    # review_run is also called by the live runner, which owns completion there.
    current = get_db().runs.find_one({"_id": args.run_id})
    if current["status"] == "reviewing":
        emit(args.run_id, "run_finished", status="done")
    print(json.dumps(signals, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
