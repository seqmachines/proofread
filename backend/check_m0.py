"""M0 done-when check. Start watch, then insert in a second process."""

import argparse
import json
import os
import time
from datetime import datetime, timezone

from db import get_db


def watch(run_id):
    events = get_db().events
    deadline = time.monotonic() + 60
    if os.getenv("STREAM_MODE", "change_stream") == "poll":
        print("READY poll", flush=True)
        while time.monotonic() < deadline:
            event = events.find_one({"run_id": run_id}, {"_id": 0})
            if event:
                print(json.dumps(event), flush=True)
                return
            time.sleep(0.25)
    else:
        with events.watch([
            {"$match": {"operationType": "insert", "fullDocument.run_id": run_id}},
        ], max_await_time_ms=1000) as stream:
            print("READY change_stream", flush=True)
            while time.monotonic() < deadline:
                change = stream.try_next()
                if change:
                    event = change["fullDocument"]
                    event.pop("_id", None)
                    print(json.dumps(event), flush=True)
                    return
    raise TimeoutError("M0 watcher did not receive the inserted event within 60 seconds")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["watch", "insert"])
    parser.add_argument("run_id", help="Use a fresh m0-<id> in both processes")
    args = parser.parse_args()
    if args.action == "watch":
        watch(args.run_id)
    else:
        get_db().events.insert_one({
            "run_id": args.run_id, "seq": 1,
            "ts": datetime.now(timezone.utc).isoformat(),
            "t": "error", "message": "M0 cross-process event probe (not an agent run)",
        })
        print("Inserted M0 event.")
