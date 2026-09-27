"""M13 done-when: installed cDNA in proofread, then an independent Claude host.

Creates and removes one synthetic run and chunk; saved runs are never edited.
Claude runs in an empty directory with only cDNA's MCP server and no built-ins.
"""

import asyncio
from copy import deepcopy
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from uuid import uuid4

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import cdna
from cdna.molecule import MoleculeState
from cdna.tools import tool_definitions
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from agent import AgentTools
from db import get_db
from engine import emit
from harness import render

BACKEND = Path(__file__).resolve().parent


def rna(evidence):
    return {"id": "S_rna", "label": "Synthetic RNA substrate",
            "strands": {"top": [{"name": "transcript", "type": "insert", "origin": "source"},
                                {"name": "poly-A tail", "type": "polyA", "origin": "source"}], "bottom": []},
            "origin": "source", "evidence": evidence, "skill_call_id": None,
            "review_status": "unreviewed", "stale_since_revision": None}


async def proofread_check():
    assert "site-packages" in Path(cdna.__file__).parts, cdna.__file__
    assert version("cdna-engine") == "0.2.0"
    assert not (BACKEND / "skills.py").exists() and not (BACKEND / "molecules.py").exists()
    db = get_db()
    saved_ids = set(db.runs.distinct("_id"))
    run_id = "m13-check-" + uuid4().hex
    chunk_id = run_id + ":source"
    protocol_id = db.protocols.find_one()["_id"]
    harness = render("v0")
    env = {"RUN_ID": run_id, "HARNESS_VERSION": "v0", "EVIDENCE_K": str(harness["evidence_k"])}
    params = StdioServerParameters(command=sys.executable, args=[str(BACKEND / "mcp_server.py")], env=env)
    try:
        db.chunks.insert_one({"_id": chunk_id, "protocol_id": protocol_id, "page": 1,
                              "kind": "page", "source_file": "M13 synthetic check",
                              "text": "Synthetic RNA, reverse transcription, and template switching check."})
        emit(run_id, "run_started", protocol_id=protocol_id, harness_version="v0", executor="none", source="live")
        with tempfile.TemporaryFile(mode="w+") as errors:
            async with stdio_client(params, errlog=errors) as (read, write):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    listed = {t.name: t for t in (await client.list_tools()).tools}
                    for tool in tool_definitions():
                        assert listed[tool["name"]].inputSchema == tool["inputSchema"]

                    async def call(name, args, *, error=False):
                        response = await client.call_tool(name, args)
                        assert response.isError == error, response
                        return response.structuredContent

                    substrate = rna([chunk_id])
                    await call("commit_state", {"state": substrate})
                    hybrid = (await call("reverse_transcribe", {"rna_state": substrate, "primer": "RT primer"}))["state"]
                    assert hybrid["skill_call_id"] and hybrid["origin"] == "skill"
                    await call("commit_state", {"state": hybrid})
                    forged = deepcopy(hybrid)
                    forged["label"] = "Changed outside the committed workflow"
                    await call("template_switch", {"hybrid": forged, "tso": "TSO handle"}, error=True)
                    switched = (await call("template_switch", {"hybrid": hybrid, "tso": "TSO handle"}))["state"]
                    assert switched["strands"]["bottom"][0]["type"] == "tso"
                    await call("commit_state", {"state": switched})
                    for tid, start, end, operation, oligo in [
                        ("T_rt", substrate, hybrid, "reverse_transcription", "RT primer"),
                        ("T_ts", hybrid, switched, "template_switching", "TSO handle"),
                    ]:
                        await call("commit_transition", {"transition": {
                            "id": tid, "from": start["id"], "to": end["id"], "op": operation,
                            "skill_call_id": end["skill_call_id"], "evidence": [chunk_id],
                            "oligos": [oligo], "discarded": []}})
                    legacy = await call("run_skill", {"skill": "template_switch", "substrate_id": hybrid["id"], "oligo_name": "TSO handle"})
                    assert legacy["state"]["strands"] == switched["strands"]
                    # The mounted entry point must honor the same harness restrictions.
                    disabled = deepcopy(harness)
                    disabled["tool_access"]["template_switch"] = "off"
                    denied = AgentTools(run_id, disabled).dispatch("template_switch", {"hybrid": hybrid, "tso": "TSO handle"})
                    assert "disabled" in denied["error"]
                    assert (await call("finish", {}))["finished"]
        emit(run_id, "run_finished", status="done")
        workflow = db.workflows.find_one({"run_id": run_id})
        assert len(workflow["states"]) == 3 and len(workflow["transitions"]) == 2
        events = list(db.events.find({"run_id": run_id}).sort("seq", 1))
        assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
        assert events[-1]["t"] == "run_finished"
        skill_events = {e["skill_call_id"]: e for e in events if e["t"] == "skill_called"}
        for state in (hybrid, switched):
            assert skill_events[state["skill_call_id"]]["result"] == state
        print("Proofread MCP passed: installed cDNA schemas, both skills, legacy adapter, guardrails, commits, and event provenance.", flush=True)
    finally:
        def cleanup(session):
            for name in ("events", "workflows"):
                db[name].delete_many({"run_id": run_id}, session=session)
            db.runs.delete_one({"_id": run_id}, session=session)
            db.chunks.delete_one({"_id": chunk_id}, session=session)
        with db.client.start_session() as session:
            session.with_transaction(cleanup)
        assert saved_ids <= set(db.runs.distinct("_id"))


def claude_check():
    hybrid = rna([])
    hybrid["strands"]["bottom"] = [
        {"name": "transcript", "type": "insert", "origin": "skill"},
        {"name": "RT primer", "type": "primer", "origin": "skill"},
    ]
    env = os.environ.copy()
    for key in ("MONGODB_URI", "RUN_ID", "HARNESS_VERSION", "EVIDENCE_K", "REVIEW_TOKENS",
                "PYTHONPATH", "LLM_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"):
        env.pop(key, None)
    with tempfile.TemporaryDirectory(prefix="cdna-host-") as directory:
        config = {"mcpServers": {"cdna": {"command": sys.executable, "args": ["-m", "cdna.mcp_server"]}}}
        prompt = ("Call mcp__cdna__template_switch exactly once with tso='TSO handle' and this hybrid: "
                  + json.dumps(hybrid) + ". Do not reconstruct the output yourself. After the tool succeeds, report the product ID and bottom-strand segment names.")
        command = ["claude", "-p", "--strict-mcp-config", "--mcp-config", json.dumps(config),
                   "--tools", "", "--allowedTools", "mcp__cdna__template_switch",
                   "--permission-mode", "dontAsk", "--setting-sources", "",
                   "--disable-slash-commands", "--no-chrome", "--no-session-persistence",
                   "--output-format", "stream-json", "--verbose", prompt]
        result = subprocess.run(command, cwd=directory, env=env, capture_output=True, text=True, timeout=180)
        assert result.returncode == 0, result.stderr[-2000:]
        events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        initial = next(e for e in events if e.get("type") == "system" and e.get("subtype") == "init")
        # Claude can emit init while the server is still connecting. A successful
        # tool_result below proves that the sole configured server became ready.
        assert [s["name"] for s in initial["mcp_servers"]] == ["cdna"], initial["mcp_servers"]
        calls = [c for e in events if e.get("type") == "assistant" for c in e["message"]["content"] if c["type"] == "tool_use"]
        assert len(calls) == 1 and calls[0]["name"] == "mcp__cdna__template_switch", {
            "calls": calls, "available_tools": initial.get("tools"),
            "result": [e.get("result") for e in events if e.get("type") == "result"],
        }
        results = [c for e in events if e.get("type") == "user" for c in e["message"]["content"]
                   if c["type"] == "tool_result" and c["tool_use_id"] == calls[0]["id"]]
        assert len(results) == 1 and not results[0].get("is_error"), results
        content = results[0]["content"]
        if isinstance(content, str):
            content = json.loads(content)
        payloads = ([content] if isinstance(content, dict) else
                    [json.loads(c["text"]) for c in content if c.get("type") == "text"])
        state = next(p["state"] for p in payloads if "state" in p)
        MoleculeState.model_validate(state)
        assert state["strands"]["bottom"][0] == {"name": "TSO handle", "type": "tso", "origin": "skill"}
        assert state["skill_call_id"] is None
        terminal = next(e for e in events if e.get("type") == "result")
        assert not terminal["is_error"] and not terminal.get("permission_denials")
        print(json.dumps({"host": "claude -p", "server": "cdna", "tool": calls[0]["name"],
                          "model": next(e["message"]["model"] for e in events if e.get("type") == "assistant"),
                          "product_id": state["id"], "bottom": [s["name"] for s in state["strands"]["bottom"]]}), flush=True)


if __name__ == "__main__":
    cli_version = subprocess.check_output(["claude", "--version"], text=True).strip()
    parts = re.search(r"(\d+)\.(\d+)\.(\d+)", cli_version)
    assert parts and tuple(map(int, parts.groups())) >= (2, 1, 221), "Use Claude Code >=2.1.221; older print mode races MCP startup"
    print(cli_version, flush=True)
    asyncio.run(proofread_check())
    claude_check()
    print("M13 DONE-WHEN PASSED; temporary run removed and existing runs preserved.", flush=True)
