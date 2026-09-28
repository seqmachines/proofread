"""M15 and walkthrough done-when checks against Atlas, with temporary reviews only."""

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
from unittest.mock import patch
from uuid import uuid4

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient

import app as api
from db import get_db
from engine import emit
from structure import project_workflow, score
from verifier_text import public_event, public_workflow


def molecule(sid, rna=False):
    return {"id": sid, "label": "Input RNA" if rna else "Product DNA",
            "strands": {"top": [{"name": "RNA insert" if rna else "cDNA insert",
                                   "type": "insert", "origin": "human"}], "bottom": []},
            "origin": "human", "evidence": [], "skill_call_id": None,
            "review_status": "unreviewed", "stale_since_revision": None}


def canonical_check():
    graph = {"states": [molecule("predicted-rna", True), molecule("predicted-dna")],
             "transitions": [{"id": "predicted-rt", "from": "predicted-rna", "to": "predicted-dna",
                              "op": "reverse_transcription", "oligos": [], "discarded": []}]}
    prediction = project_workflow(graph)
    truth = deepcopy(prediction)
    # Rename every entity, including strand and segment references; scramble order.
    def renamed(value):
        if isinstance(value, list):
            return [renamed(x) for x in value]
        if isinstance(value, dict):
            return {k: ("truth-" + v if k in {"state_id", "transition_id", "strand_id", "segment_id"}
                        else ["truth-" + x for x in v] if k.endswith("_state_ids") or k.endswith("_product_ids") or k == "segment_ids"
                        else renamed(v)) for k, v in value.items()}
        return value
    truth = renamed(truth)
    truth["states"].reverse()
    metrics, diff, pairs = score(prediction, truth)
    assert metrics == {"structure_f1": 1.0, "edge_f1": 1.0}, metrics
    assert len(pairs) == 2 and all(p["state_id"] != p["truth_id"] and p["similarity"] == 1 for p in pairs)
    assert diff["matched_transitions"] == [{"transition_id": "predicted-rt", "truth_id": "truth-predicted-rt", "similarity": 1.0}]
    assert not any(diff[k] for k in ("missing_states", "extra_states", "missing_transitions", "extra_transitions"))
    changed = deepcopy(prediction)
    changed["transitions"][0]["operation"] = "ligation"
    assert score(changed, truth)[1]["matched_transitions"][0]["similarity"] < 1
    changed["transitions"][0]["substrate_state_ids"] = ["predicted-dna"]
    assert score(changed, truth)[0]["edge_f1"] < 1
    empty = {"states": [], "transitions": []}
    assert len(score(empty, truth)[1]["missing_states"]) == 2
    assert len(score(empty, truth)[1]["missing_transitions"]) == 1
    assert len(score(prediction, empty)[1]["extra_states"]) == 2
    assert len(score(prediction, empty)[1]["extra_transitions"]) == 1
    print("Canonical alignment: renamed IDs, operation/endpoint differences, unmatched entities passed.", flush=True)


def check():
    canonical_check()
    db = get_db()
    baseline = {r["_id"]: r["step"] for r in db.runs.find({}, {"step": 1})}
    protocols = sorted(db.benchmark_records.distinct("protocol_id"))
    assert len(protocols) == len(baseline) == 20
    tokens = {role: secrets.token_urlsafe(32) for role in ("curator", "legacy")}
    env = {"EXECUTOR": "none", "STREAM_MODE": "poll",
           "REVIEW_TOKENS": f"{tokens['curator']}:M15 check:curator,{tokens['legacy']}:Legacy author:author"}
    headers = {role: {"X-Review-Token": token} for role, token in tokens.items()}
    run_ids, invite_ids = [], []
    try:
        with patch.dict(os.environ, env), TestClient(api.app) as client, patch.object(
                api, "get_executor", side_effect=AssertionError("Disabled writes invoked an executor")):
            assert client.get("/invites").status_code == 401
            assert client.post("/invites", json={}).status_code == 401
            assert client.post("/invites", json={"protocol_id": "missing", "name": "Test"}, headers=headers["curator"]).status_code == 404
            assert client.post("/invites", json={"protocol_id": protocols[0], "name": " "}, headers=headers["curator"]).status_code == 422
            response = client.post("/invites", json={"protocol_id": protocols[0], "name": "M15 author check"}, headers=headers["curator"])
            assert response.status_code == 200, response.text
            invitation = response.json()
            invite_ids.append(invitation["invite_id"])
            assert invitation["role"] == "author" and invitation["protocol_id"] == protocols[0]
            token = invitation["token"]
            headers["author"] = {"X-Review-Token": token}
            saved = db.invites.find_one({"invite_id": invitation["invite_id"]})
            assert saved["_id"] == hashlib.sha256(token.encode()).hexdigest()
            assert token not in json.dumps(saved)
            listing = client.get("/invites", headers=headers["curator"])
            assert listing.status_code == 200
            assert any(i["invite_id"] == invitation["invite_id"] for i in listing.json())
            assert all(set(i) == {"invite_id", "protocol_id", "name", "role", "created_at"} for i in listing.json())
            assert client.get("/invites/", headers=headers["author"]).status_code == 403
            assert client.get("/invites", headers={"X-Review-Token": "invalid"}).status_code == 401

            for protocol in protocols[:2]:
                rid = "m15-check-" + uuid4().hex
                run_ids.append(rid)
                emit(rid, "run_started", protocol_id=protocol, harness_version="m15-check", executor="none", source="live")
                emit(rid, "state_committed", state=molecule("synthetic-product"), workflow_revision=1)
                emit(rid, "run_finished", status="done")
            own, other = run_ids
            before = client.get(f"/runs/{own}").json()["workflow"]["states"][0]
            body = {"run_id": own, "workflow_revision": 1, "target_id": before["id"],
                    "decision": "accept", "before": before, "note": "Temporary M15 scope check."}
            assert client.post(f"/runs/{own}/reviews", json=body).status_code == 401
            assert client.post(f"/runs/{own}/reviews", json=body, headers=headers["legacy"]).status_code == 403
            assert client.post(f"/runs/{own}/reviews", json={**body, "reviewer": {"role": "curator"}}, headers=headers["author"]).status_code == 422
            response = client.post(f"/runs/{own}/reviews", json=body, headers=headers["author"])
            assert response.status_code == 200, response.text
            review = db.reviews.find_one({"_id": response.json()["review_id"]})
            assert review["reviewer"] == {"id": invitation["invite_id"], "name": invitation["name"], "role": "author"}
            assert client.get(f"/runs/{own}").json()["workflow"]["states"][0]["review_status"] == "accepted"
            snapshots = {rid: list(db.events.find({"run_id": rid})) for rid in run_ids}
            for suffix in ("reviews", "messages", "patches/p/apply"):
                response = client.post(f"/runs/{other}/{suffix}", json={**body, "run_id": other}, headers=headers["author"])
                assert response.status_code == 403, (suffix, response.text)
            # The route/body ID mismatch cannot bypass scope, even from the allowed URL.
            assert client.post(f"/runs/{own}/reviews", json={**body, "run_id": other}, headers=headers["author"]).status_code == 422
            for path in ("/invites", "/import", "/harness/evolve", "/harness/gate/v0"):
                assert client.post(path, json={}, headers=headers["author"]).status_code == 403
            assert client.post("/runs", json={"protocol_id": protocols[1]}, headers=headers["author"]).status_code == 403
            assert client.post("/runs", json={"protocol_id": protocols[0]}, headers=headers["author"]).status_code == 501
            assert client.post(f"/runs/{own}/messages", json={"text": "Edit this graph"}, headers=headers["author"]).status_code == 501
            assert all(list(db.events.find({"run_id": rid})) == events for rid, events in snapshots.items())
            print("Author review: own protocol 200; other protocol and curator actions 403; chat 501 with no writes.", flush=True)
            path = "/invites/" + invitation["invite_id"]
            assert client.delete(path).status_code == 401
            assert client.delete(path, headers=headers["author"]).status_code == 403
            preflight = client.options(path, headers={"Origin": os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")[0].strip(),
                "Access-Control-Request-Method": "DELETE", "Access-Control-Request-Headers": "X-Review-Token"})
            assert preflight.status_code == 200 and "DELETE" in preflight.headers["access-control-allow-methods"]
            deleted = client.delete(path, headers=headers["curator"])
            assert deleted.status_code == 204 and not deleted.content
            assert client.delete(path, headers=headers["curator"]).status_code == 404
            assert client.post(f"/runs/{own}/reviews", json=body, headers=headers["author"]).status_code == 401
            assert db.reviews.find_one({"_id": review["_id"]}) == review
            print("Invite deletion: curator-only, browser preflight, token revocation and retained review passed.", flush=True)

            paper = db.runs.find_one({"protocol_id": "smart_seq", "source": "benchmark"})
            rid = paper["run_id"]
            diff = client.get(f"/runs/{rid}/gt-diff").json()
            assert set(diff) == {"matched_states", "matched_transitions", "missing_states", "extra_states",
                                 "missing_transitions", "extra_transitions", "missing_edges", "extra_edges"}
            workflow = db.workflows.find_one({"run_id": rid}, {"_id": 0})
            for key, entities in (("states", workflow["states"]), ("transitions", workflow["transitions"])):
                matched = diff["matched_" + key]
                assert matched and all(set(p) == {"predicted", "truth", "similarity"} and 0 <= p["similarity"] <= 1 for p in matched)
                assert len(matched) + len(diff["extra_" + key]) == len(entities)
            raw = list(db.events.find({"run_id": rid}, {"_id": 0}).sort("seq", 1))
            assert client.get(f"/runs/{rid}/events").json() == [public_event(e) for e in raw]
            assert client.get(f"/runs/{rid}").json()["workflow"] == public_workflow(workflow)
            assert raw == list(db.events.find({"run_id": rid}, {"_id": 0}).sort("seq", 1))
            checks = [public_event(e) for e in db.events.find({"t": "verifier_check"}, {"_id": 0})]
            assert all("_" not in c["check"] and "_" not in c["message"] for c in checks)
            assert all(not re.search(r"\b(?:err|state|st|transition|tr|strand|segment)[_.:]|\b[ST]\d+\b|\btr\d+\b|/workspace/|/tmp/|Attribution:", c["message"]) for c in checks)
            assert all(public_event(c) == c for c in checks)
            print(f"SMART-seq canonical diff and {len(checks)} public verifier messages passed.", flush=True)

            sources, chunk_count = set(), 0
            for protocol in protocols:
                chunks = list(db.chunks.find({"protocol_id": protocol, "provenance.manifest_sha256": {"$exists": True}}))
                assert chunks, protocol
                chunk_count += len(chunks)
                for chunk in chunks:
                    sources.add((protocol, chunk["source_file"]))
                    assert len(chunk["provenance"]["sha256"]) == 64 and len(chunk["provenance"]["revision"]) == 40
                assert client.get("/chunks/" + chunks[0]["_id"]).status_code == 200
            refs = {hit["chunk_id"] for e in db.events.find({"run_id": {"$in": list(baseline)}, "t": "evidence_searched"}) for hit in e["results"]}
            refs.update(c for w in db.workflows.find({"run_id": {"$in": list(baseline)}}) for s in w["states"] + w["transitions"] for c in s["evidence"])
            assert db.chunks.count_documents({"_id": {"$in": list(refs)}}) == len(refs)
            assert len(sources) == 58
            print(f"Frozen sources: 20 protocols, {len(sources)} files, {chunk_count} chunks; all {len(refs)} cited chunks resolve.", flush=True)
    finally:
        # Delete only records created by this check; saved reviews remain append-only.
        def cleanup(session):
            for name in ("events", "workflows", "reviews", "runs"):
                db[name].delete_many({"run_id": {"$in": run_ids}}, session=session)
            db.invites.delete_many({"invite_id": {"$in": invite_ids}}, session=session)
        with db.client.start_session() as session:
            session.with_transaction(cleanup)
    assert baseline == {r["_id"]: r["step"] for r in db.runs.find({}, {"step": 1})}
    print("M15 DONE-WHEN PASSED; temporary records removed, all 20 saved runs unchanged.", flush=True)


if __name__ == "__main__":
    check()
