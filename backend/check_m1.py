"""M1 done-when check against a known TSO page from protocol A."""

import argparse
import json

from db import get_db
from evidence import search_evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", required=True, help="Protocol A's meta.json id or folder name")
    parser.add_argument("--chunk", required=True, help="Expected TSO chunk ID from seed.py")
    args = parser.parse_args()
    db = get_db()
    protocol = db.protocols.find_one({"_id": args.protocol})
    if not protocol or protocol["role"] != "dev":
        raise ValueError("The M1 check must use a seeded dev protocol")
    expected = db.chunks.find_one({"_id": args.chunk, "protocol_id": args.protocol})
    if not expected:
        raise ValueError("Expected TSO chunk does not belong to this protocol")
    results = search_evidence("template switching oligo", protocol=args.protocol)
    print(json.dumps([{**result, "snippet": result["snippet"][:240]} for result in results], indent=2))
    if not any(result["chunk_id"] == args.chunk for result in results):
        raise AssertionError("M1 failed: the TSO chunk was not retrieved; check Atlas index readiness")
    print(f"M1 PASS: template switching oligo retrieved {args.chunk}")
