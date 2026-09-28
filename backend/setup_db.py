"""Explicit setup-only collection creation and indexes; never imported by runtime."""

from datetime import datetime, timezone

if __package__:
    from .db import get_db
else:
    from db import get_db


def initialize():
    db = get_db()
    db.command("ping")
    existing = set(db.list_collection_names())
    for name in (
        "protocols", "chunks", "ground_truth", "harness_versions",
        "runs", "events", "workflows", "signals",
        "benchmark_records", "reviews", "entities", "invites",
    ):
        if name not in existing:
            db.create_collection(name)

    db.ground_truth.create_index("protocol_id", unique=True)
    db.harness_versions.create_index("status")
    db.events.create_index([("run_id", 1), ("seq", 1)], unique=True)
    db.workflows.create_index("run_id", unique=True)
    db.signals.create_index([("signature", 1), ("harness_version", 1)])
    db.signals.create_index("processed")
    db.reviews.create_index([("run_id", 1), ("created_at", 1)])
    db.entities.create_index([("verified", 1), ("operation", 1), ("type", 1)])
    db.benchmark_records.create_index([("executor", 1), ("model", 1), ("harness_version", 1), ("protocol_id", 1)])
    db.benchmark_records.create_index("source_path", unique=True)
    db.runs.create_index([("executor", 1), ("model", 1), ("harness_version", 1), ("protocol_id", 1)],
                        unique=True, partialFilterExpression={"source": "benchmark"}, name="benchmark_identity")
    db.chunks.create_index([("protocol_id", 1), ("text", "text")], name="chunks_text")
    db.chunks.create_index([("protocol_id", 1), ("source_file", 1), ("page", 1)])

    # Migration of existing installations. New clusters need only the ordinary
    # MongoDB text index, which is ready when create_index returns.
    for index in db.chunks.list_search_indexes():
        if index["name"] == "chunks_vec" or index.get("type") == "vectorSearch":
            db.chunks.drop_search_index(index["name"])
    removed = db.chunks.update_many({"embedding": {"$exists": True}}, {"$unset": {"embedding": ""}})
    db.chunks.update_many({"kind": "text"}, {"$set": {"kind": "page"}})

    db.harness_versions.update_one({"_id": "v0"}, {"$setOnInsert": {
        "parent_id": None,
        "status": "active",
        "rules": [],
        "context_policy": {
            "evidence_k": 5,
            "history": "full",
            "include_linked_oligos": False,
        },
        "guardrails": ["evidence_required"],
        "tool_access": {"reverse_transcribe": "available", "template_switch": "available"},
        "patches": [],
        "source_signals": [],
        "eval": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    print(f"Initialized proofread collections, chunks_text, indexes, and v0; removed {removed.modified_count} legacy vectors.")


if __name__ == "__main__":
    initialize()
