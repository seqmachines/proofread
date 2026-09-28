"""Protocol reconstruction API and replay followed by live SSE."""

import asyncio
import json
import logging
import os
import shutil
from collections import defaultdict
from ipaddress import ip_address
from typing import Literal
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import PyMongoError
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from db import get_db
from auth import authorize, create_invite, require_protocol, requires_review_token, reviewer_for_token
from verifier_text import public_event, public_workflow
from engine import create_run
from evolver import evolve_run
from gate import gate_and_finish
from executor import get_executor
from harness import render
from runner import run_reconstruction
from verifier import NoGroundTruth, compare_ground_truth
from review_models import ReviewRequest
from reviews import ReviewConflict, record_review, review_need

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    app.state.tail_client = AsyncIOMotorClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=15000)
    try:
        yield
    finally:
        app.state.tail_client.close()


app = FastAPI(title="proofread", lifespan=lifespan)


@app.middleware("http")
async def authenticate_writes(request, call_next):
    if requires_review_token(request.method, request.url.path.rstrip("/")):
        try:
            request.state.reviewer = await run_in_threadpool(reviewer_for_token, request.headers.get("x-review-token", ""))
            await run_in_threadpool(authorize, request.state.reviewer, request.url.path.rstrip("/"))
        except HTTPException as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return await call_next(request)


app.add_middleware(CORSMiddleware, allow_origins=[v.strip() for v in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if v.strip()],
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])


def require_run(run_id):
    run = get_db().runs.find_one({"_id": run_id}, {"_id": 0})
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def stored_events(run_id, since):
    return [public_event(e) for e in get_db().events.find(
        {"run_id": run_id, "seq": {"$gt": since}}, {"_id": 0}).sort("seq", 1)]


class InviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    protocol_id: str = Field(min_length=1, max_length=240)
    name: str = Field(min_length=1, max_length=200)


@app.post("/invites")
def post_invite(body: InviteRequest):
    return create_invite(body.protocol_id, body.name)


@app.get("/invites")
def get_invites():
    return list(get_db().invites.find({}, {"_id": 0}).sort([("created_at", -1), ("invite_id", 1)]))


@app.delete("/invites/{invite_id}", status_code=204)
def delete_invite(invite_id: str):
    if not get_db().invites.delete_one({"invite_id": invite_id}).deleted_count:
        raise HTTPException(status_code=404, detail="Invite not found")
    return Response(status_code=204)


@app.get("/config")
def get_config():
    executor = os.getenv("EXECUTOR", "codex")
    return {"executor": executor,
            "live_runs": executor == "codex" and bool(os.getenv("CODEX_MODEL")) and bool(shutil.which("codex")),
            "stream_mode": "poll" if os.getenv("STREAM_MODE") == "poll" else "stream"}


@app.get("/protocols")
def get_protocols():
    db = get_db()
    scores = {w["run_id"]: w["benchmark_score"] for w in db.workflows.find(
        {"benchmark_score": {"$ne": None}}, {"run_id": 1, "benchmark_score": 1})}
    sources = defaultdict(list)
    for run in db.runs.find().sort([("executor", 1), ("model", 1), ("harness_version", 1), ("run_id", 1)]):
        source = {"run_id": run["run_id"], "source": run.get("source", "live"),
                  "executor": run.get("executor", "unknown"), "model": run.get("model", "unknown"),
                  "harness_version": run["harness_version"]}
        if run["run_id"] in scores:
            source["benchmark_score"] = scores[run["run_id"]]
        sources[run["protocol_id"]].append(source)
    return [{"id": p["_id"], **{k: p[k] for k in ("name", "family", "role", "has_gt")},
             "sources": sources[p["_id"]]}
            for p in db.protocols.find().sort("name", 1)]


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["benchmark", "harbor"]
    path: str


@app.post("/import")
def post_import(body: ImportRequest, request: Request):
    # Authentication is shared with the other write routes; imports stay local.
    try:
        local = request.client is not None and ip_address(request.client.host).is_loopback
    except ValueError:
        local = False
    if (not local or request.headers.get("origin") not in {None, "http://localhost:3000"}
            or request.headers.get("sec-fetch-site") == "cross-site"):
        raise HTTPException(status_code=403, detail="Import is available only to the local curator")
    from import_benchmark import ImportConflict, import_benchmark
    try:
        return import_benchmark(body.path, source=body.source)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except ImportConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid benchmark record: {exc}") from exc


@app.get("/queue")
def get_queue():
    """Saved runs still needing a review, ordered by outstanding work."""
    db = get_db()
    protocols = {p["_id"]: p["name"] for p in db.protocols.find({}, {"name": 1})}
    workflows = {w["run_id"]: w for w in db.workflows.find({}, {"_id": 0})}
    reviews = defaultdict(list)
    for review in db.reviews.find():
        reviews[review["run_id"]].append(review)
    rows = []
    for run in db.runs.find().sort("created_at", -1):
        workflow = workflows.get(run["run_id"], {})
        unreviewed, unresolved, _ = review_need(workflow, reviews[run["run_id"]])
        if not unreviewed and not unresolved:
            continue
        rows.append({"run_id": run["run_id"], "protocol": protocols.get(run["protocol_id"], run["protocol_id"]),
                     "executor": run.get("executor", "codex"), "harness_version": run["harness_version"],
                     "unreviewed_failed_checks": unreviewed, "unresolved": unresolved,
                     # Saved benchmark state F1 must not masquerade as structure F1.
                     # Its separately named metrics are available on GET /runs/{id}.
                     "score": (workflow.get("gt_score") or {}).get("structure_f1")})
    return sorted(rows, key=lambda r: (-r["unreviewed_failed_checks"], -r["unresolved"]))


@app.post("/runs/{run_id}/reviews")
def post_review(run_id: str, body: ReviewRequest, request: Request):
    try:
        reviewer = {k: request.state.reviewer[k] for k in ("id", "name", "role")}
        return record_review(run_id, body, reviewer)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReviewConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/runs/{run_id}/reviews")
def get_reviews(run_id: str):
    require_run(run_id)
    return list(get_db().reviews.find({"run_id": run_id}).sort([("created_at", 1), ("_id", 1)]))


@app.get("/memory")
def get_memory(operation: str | None = None, type: str | None = None):
    query = {"verified": True}
    if operation is not None:
        query["operation"] = operation
    if type is not None:
        query["type"] = type
    return list(get_db().entities.find(query).sort("created_at", -1))


@app.get("/benchmark")
def get_benchmark(group_by: Literal["version", "executor", "protocol"] = "version"):
    db = get_db()
    runs = {r["run_id"]: r for r in db.runs.find()}
    groups = defaultdict(list)
    field = {"version": "harness_version", "executor": "executor", "protocol": "protocol_id"}[group_by]
    for workflow in db.workflows.find():
        run = runs.get(workflow["run_id"])
        if run:
            version = (workflow.get("benchmark_score") or {}).get("benchmark_version")
            groups[(run.get(field, "unknown"), version)].append(workflow)
    rows = []
    def averages(values):
        keys = sorted({k for v in values for k in v})
        return {k: sum(v[k] for v in values if k in v) / sum(k in v for v in values) for k in keys}
    for (group, version), workflows in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1] or "")):
        saved = [w["benchmark_score"]["metrics"] for w in workflows if w.get("benchmark_score")]
        truth = [w["gt_score"] for w in workflows if w.get("gt_score")]
        rows.append({"group": group, "group_by": group_by, "runs": len(workflows),
                     "benchmark_score": {"benchmark_version": version, "metrics": averages(saved)} if saved else None,
                     "gt_score": averages(truth) if truth else None, "gt_scored_runs": len(truth)})
    return rows


class StartRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol_id: str
    harness_version: str | None = None
    executor: Literal["codex", "claude", "gemini", "api", "none"] | None = None


@app.post("/runs")
def start_run(body: StartRun, tasks: BackgroundTasks, request: Request):
    require_protocol(request.state.reviewer, body.protocol_id)
    configured = os.getenv("EXECUTOR", "codex")
    executor = body.executor or configured
    if configured == "none" or executor == "none":
        raise HTTPException(status_code=501, detail="Live reconstruction is disabled")
    if executor != "codex":
        raise HTTPException(status_code=501, detail=f"Executor {executor} is not implemented")
    db = get_db()
    if not db.protocols.find_one({"_id": body.protocol_id}):
        raise HTTPException(status_code=404, detail="Protocol not found")
    version = db.harness_versions.find_one(
        {"_id": body.harness_version} if body.harness_version else {"status": "active"})
    if version is None:
        raise HTTPException(status_code=404, detail="Harness version not found")
    try:
        get_executor(render(version["_id"]), executor=executor)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    run_id = create_run(body.protocol_id, version["_id"], executor=executor)
    tasks.add_task(run_reconstruction, run_id)
    return {"run_id": run_id}


@app.get("/chunks/{chunk_id}")
def get_chunk(chunk_id: str):
    chunk = get_db().chunks.find_one({"_id": chunk_id}, {"protocol_id": 1, "page": 1, "text": 1})
    if chunk is None:
        raise HTTPException(status_code=404, detail="Chunk not found")
    chunk["chunk_id"] = chunk.pop("_id")
    return chunk


@app.get("/harness")
def get_harness():
    version = get_db().harness_versions.find_one({"status": "active"})
    if version is None:
        raise HTTPException(status_code=404, detail="No active harness")
    return version


@app.get("/harness/versions")
def get_harness_versions():
    return list(get_db().harness_versions.find().sort("created_at", -1))


@app.get("/harness/versions/{version}")
def get_harness_version(version: str):
    result = get_db().harness_versions.find_one({"_id": version})
    if result is None:
        raise HTTPException(status_code=404, detail="Harness version not found")
    return result


class EvolveRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str


@app.post("/harness/evolve")
def post_evolve(body: EvolveRun, tasks: BackgroundTasks):
    require_run(body.run_id)
    try:
        version = evolve_run(body.run_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    tasks.add_task(gate_and_finish, version)
    return {"version": version}


@app.post("/harness/gate/{version}")
def post_gate(version: str):
    if get_db().harness_versions.find_one({"_id": version}) is None:
        raise HTTPException(status_code=404, detail="Harness version not found")
    try:
        return gate_and_finish(version)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    return {"run": require_run(run_id),
            "workflow": public_workflow(get_db().workflows.find_one({"run_id": run_id}, {"_id": 0}))}


@app.post("/runs/{run_id}/messages")
def post_message(run_id: str):
    require_run(run_id)
    if os.getenv("EXECUTOR", "codex") == "none":
        raise HTTPException(status_code=501, detail="Chat editing is disabled; use a typed review")
    raise HTTPException(status_code=501, detail="Chat editing is not implemented")


@app.get("/runs/{run_id}/events")
def get_events(run_id: str, since: int = Query(0, ge=0)):
    require_run(run_id)
    return stored_events(run_id, since)


@app.get("/runs/{run_id}/gt-diff")
def get_gt_diff(run_id: str):
    require_run(run_id)
    try:
        return compare_ground_truth(run_id)["diff"]
    except NoGroundTruth as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/runs/{run_id}/stream")
def stream(run_id: str, request: Request, since: int = Query(0, ge=0),
           speed: float = Query(1, gt=0, allow_inf_nan=False)):
    require_run(run_id)

    async def generate():
        last_seq = since

        def frame(event):
            return f"data: {json.dumps(public_event(event))}\n\n"

        async def replay():
            nonlocal last_seq
            for event in await run_in_threadpool(stored_events, run_id, last_seq):
                if await request.is_disconnected():
                    return
                last_seq = event["seq"]
                yield frame(event)
                if speed > 1:
                    await asyncio.sleep(1 / speed)

        if os.getenv("STREAM_MODE", "change_stream") != "poll":
            try:
                events = request.app.state.tail_client["proofread"].events
                # Open first so events written during replay remain in the tail.
                async with events.watch([
                    {"$match": {"operationType": "insert", "fullDocument.run_id": run_id}},
                ], max_await_time_ms=1000) as changes:
                    async for data in replay():
                        yield data
                    heartbeat = asyncio.get_running_loop().time()
                    while not await request.is_disconnected():
                        change = await changes.try_next()
                        if change is None and not changes.alive:
                            raise PyMongoError("Event change stream closed")
                        if change:
                            event = change["fullDocument"]
                            event.pop("_id", None)
                            if event["seq"] > last_seq:
                                last_seq = event["seq"]
                                yield frame(event)
                        if asyncio.get_running_loop().time() - heartbeat >= 15:
                            yield ": keep-alive\n\n"
                            heartbeat = asyncio.get_running_loop().time()
                return
            except PyMongoError:
                logger.warning("Change stream unavailable for %s; polling from seq %s", run_id, last_seq)

        # Explicit M0 fallback, also used after a change-stream failure. Reading
        # from the last delivered seq recovers any events missed by the cursor.
        heartbeat = asyncio.get_running_loop().time()
        while not await request.is_disconnected():
            async for data in replay():
                yield data
            if asyncio.get_running_loop().time() - heartbeat >= 15:
                yield ": keep-alive\n\n"
                heartbeat = asyncio.get_running_loop().time()
            await asyncio.sleep(0.25)

    return StreamingResponse(generate(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
    })
