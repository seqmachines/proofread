"""Score an existing run: python -m backend.verify RUN_ID [--export PATH]."""

import argparse
import json
import sys
from pathlib import Path

# Existing backend modules also run as top-level modules under uvicorn
# --app-dir backend. Keep this module entry point compatible with that layout.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_db
from gate import evaluate_existing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--export", type=Path, help="Export the exact stored event log, ordered by seq")
    args = parser.parse_args()
    try:
        report = evaluate_existing(args.run_id)
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    if args.export:
        events = list(get_db().events.find({"run_id": args.run_id}, {"_id": 0}).sort("seq", 1))
        if not events or events[-1]["t"] != "run_finished":
            parser.exit(1, "Cannot export an unfinished verification\n")
        args.export.parent.mkdir(parents=True, exist_ok=True)
        args.export.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events))
        report["export"] = {"path": str(args.export), "events": len(events)}
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
