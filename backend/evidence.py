"""Protocol-filtered evidence retrieval; no ground-truth access."""

from db import get_db


def search_evidence(query: str, protocol: str, k: int = 5) -> list[dict]:
    if not protocol or not query.strip() or not 1 <= k <= 100:
        raise ValueError("Provide a protocol ID and evidence_k between 1 and 100")
    chunks = get_db().chunks.find(
        {"protocol_id": protocol, "$text": {"$search": query}},
        {"_id": 1, "page": 1, "text": 1},
    ).sort([("score", {"$meta": "textScore"}), ("_id", 1)]).limit(k)
    return [{"chunk_id": c["_id"], "page": c["page"], "snippet": c["text"]} for c in chunks]


def list_sources(protocol: str) -> list[dict]:
    """Inventory source documents and their page/sheet chunk IDs for this run."""
    if not protocol:
        raise ValueError("Provide a protocol ID")
    sources = {}
    for chunk in get_db().chunks.find({"protocol_id": protocol},
            {"source_file": 1, "page": 1, "kind": 1}).sort([("source_file", 1), ("page", 1), ("_id", 1)]):
        name = chunk.get("source_file", "source")
        sources.setdefault(name, {"source_file": name, "pages": []})["pages"].append({
            "chunk_id": chunk["_id"], "page": chunk["page"], "kind": chunk["kind"],
        })
    return list(sources.values())


def read_page(chunk_id: str, protocol: str) -> dict:
    """Read one source chunk; another protocol's chunk is never visible."""
    if not protocol:
        raise ValueError("Provide a protocol ID")
    chunk = get_db().chunks.find_one({"_id": chunk_id, "protocol_id": protocol}, {"page": 1, "text": 1})
    if chunk is None:
        raise ValueError("Source page not found in this protocol")
    return {"chunk_id": chunk["_id"], "page": chunk["page"], "snippet": chunk["text"]}
