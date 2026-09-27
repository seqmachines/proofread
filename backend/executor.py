"""Execution transport; a future ApiLoopExecutor can implement Executor."""

import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path

from agent import MAX_STEPS
from db import get_db
from engine import checkpoint, emit
from harness import render

BACKEND = Path(__file__).resolve().parent


class Executor(ABC):
    @abstractmethod
    def execute(self, run_id: str) -> None:
        """Reconstruct, or raise; the caller runs completion hooks and finishes."""


class CliExecutor(Executor):
    @staticmethod
    def validate(harness: dict):
        if harness["context_policy"]["history"] != "full":
            raise ValueError("CliExecutor requires history=full; state_only needs ApiLoopExecutor")
        if not os.getenv("CODEX_MODEL"):
            raise ValueError("Set CODEX_MODEL in backend/.env")
        if not shutil.which("codex"):
            raise ValueError("codex CLI is not installed or not on PATH")

    @staticmethod
    def review_json(prompt: str, schema: dict) -> tuple[dict, dict]:
        """One tool-free review turn, using the existing ChatGPT login."""
        CliExecutor.validate({"context_policy": {"history": "full"}})
        if os.getenv("EXECUTOR", "codex") != "codex":
            raise ValueError("Review requires EXECUTOR=codex")
        with tempfile.TemporaryDirectory(prefix="proofread-review-") as directory:
            root = Path(directory)
            workdir = root / "work"
            workdir.mkdir()
            schema_path, output_path = root / "schema.json", root / "response.json"
            schema_path.write_text(json.dumps(schema))
            command = ["codex", "exec", "--ignore-user-config", "--skip-git-repo-check",
                       "--ephemeral", "--sandbox", "read-only", "--json", "--color", "never",
                       "--model", os.environ["CODEX_MODEL"], "--cd", str(workdir),
                       "--output-schema", str(schema_path), "--output-last-message", str(output_path)]
            for key, value in {
                "approval_policy": "never", "web_search": "disabled", "mcp_servers": {},
                "features.shell_tool": False, "features.multi_agent": False,
                "features.unified_exec": False, "features.apps": False,
                "features.remote_plugin": False, "features.hooks": False,
                "model_reasoning_effort": "low",
            }.items():
                # Empty MCP config is already guaranteed by ignore-user-config;
                # TOML inline tables use braces just like JSON's empty object.
                command += ["-c", f"{key}={json.dumps(value)}"]
            command.append("-")
            environment = os.environ.copy()
            for name in ("MONGODB_URI", "LLM_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "REVIEW_TOKENS"):
                environment.pop(name, None)
            with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, env=environment,
                                  start_new_session=True) as process:
                try:
                    stdout, stderr = process.communicate(prompt, timeout=180)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    raise RuntimeError("Reviewer exceeded the three-minute limit") from None
            if process.returncode != 0:
                # Avoid putting CLI stderr, source text, or credentials in events.
                raise RuntimeError(f"Codex reviewer exited with status {process.returncode}")
            events = [json.loads(line) for line in stdout.splitlines() if line.strip()]
            turns = [e for e in events if e.get("type") == "turn.completed"]
            if len(turns) != 1 or any(e.get("type") in {"turn.failed", "error"} for e in events):
                raise RuntimeError("Reviewer must complete exactly one successful turn")
            if any(e["item"].get("type") not in {"reasoning", "agent_message"}
                   for e in events if "item" in e):
                raise RuntimeError("Reviewer attempted a tool call")
            if not output_path.exists():
                raise RuntimeError("Reviewer produced no structured response")
            return json.loads(output_path.read_text()), turns[0].get("usage", {})

    def execute(self, run_id: str) -> None:
        db = get_db()
        run = db.runs.find_one({"_id": run_id})
        protocol = db.protocols.find_one({"_id": run["protocol_id"]})
        task = (f"Reconstruct {protocol['name']} ({run['protocol_id']}) from its protocol evidence "
                "through the final sequencing library. Use only the proofread MCP tools. "
                "Start by listing sources and reading evidence, persist states and transitions, then call finish. "
                "After finish succeeds, send a brief summary and exit without further tools.")
        with tempfile.TemporaryDirectory(prefix="proofread-") as directory:
            workdir = Path(directory)
            harness = render(run["harness_version"], workdir=workdir, task=task)
            self.validate(harness)
            mcp = {"command": sys.executable, "args": [str(BACKEND / "mcp_server.py")],
                   "env": {"RUN_ID": run_id, "HARNESS_VERSION": run["harness_version"],
                           "EVIDENCE_K": str(harness["evidence_k"])},
                   "required": True, "startup_timeout_sec": 30, "tool_timeout_sec": 90}
            command = ["codex", "exec", "--ignore-user-config", "--skip-git-repo-check",
                       "--ephemeral", "--sandbox", "read-only", "--json", "--color", "never",
                       "--model", os.environ["CODEX_MODEL"], "--cd", directory]
            # Keep the saved ChatGPT login but expose only this run's MCP server.
            # A read-only shell could still read seed annotations, so remove it.
            overrides = {
                "approval_policy": "never", "web_search": "disabled",
                "features.shell_tool": False, "features.multi_agent": False,
                "features.unified_exec": False,
                "features.apps": False, "features.remote_plugin": False,
                "features.hooks": False, "model_reasoning_effort": "low",
            }
            for key, value in overrides.items():
                command += ["-c", f"{key}={json.dumps(value)}"]
            for key, value in mcp.items():
                if key == "env":
                    for env_key, env_value in value.items():
                        command += ["-c", f"mcp_servers.proofread.env.{env_key}={json.dumps(env_value)}"]
                else:
                    command += ["-c", f"mcp_servers.proofread.{key}={json.dumps(value)}"]
            allowed_tools = [t["function"]["name"] for t in harness["tools"]]
            command += ["-c", f"mcp_servers.proofread.enabled_tools={json.dumps(allowed_tools)}"]
            for name in allowed_tools:
                command += ["-c", f'mcp_servers.proofread.tools.{name}.approval_mode="approve"']
            command.append("Read AGENTS.md and carry out its current task using the proofread MCP tools.")
            # Credentials are loaded only by the MCP server from backend/.env.
            environment = os.environ.copy()
            for name in ("MONGODB_URI", "LLM_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "REVIEW_TOKENS"):
                environment.pop(name, None)
            with tempfile.TemporaryFile(mode="w+t") as stderr:
                process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=stderr,
                                           text=True, env=environment, start_new_session=True)
                try:
                    self.consume(process, run_id)
                    if process.wait(timeout=10) != 0:
                        raise RuntimeError(f"codex exec exited with status {process.returncode}")
                except Exception as exc:
                    stderr.seek(0)
                    details = stderr.read()[-3000:]
                    # Do not copy credentials or connection URIs into event logs.
                    for key in ("MONGODB_URI", "LLM_API_KEY"):
                        secret = os.getenv(key)
                        if secret:
                            details = details.replace(secret, "[redacted]")
                    raise RuntimeError(f"{exc}\n{details}".strip()) from exc
                finally:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGTERM)
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            os.killpg(process.pid, signal.SIGKILL)
                            process.wait()
                    process.stdout.close()

    def consume(self, process, run_id):
        lines = queue.Queue()

        def read_lines():
            try:
                for line in process.stdout:
                    lines.put(line)
            finally:
                lines.put(None)

        threading.Thread(target=read_lines, daemon=True).start()
        deadline, step, finished, failure = time.monotonic() + 600, 0, False, None
        cumulative, seen = 0, set()
        while True:
            if time.monotonic() > deadline:
                raise RuntimeError("codex exec exceeded the ten-minute run limit")
            try:
                line = lines.get(timeout=1)
            except queue.Empty:
                continue
            if line is None:
                break
            event = json.loads(line)
            item = event.get("item", {})
            if event["type"] == "item.completed" and item.get("type") == "agent_message":
                if item["id"] not in seen and item.get("text", "").strip():
                    seen.add(item["id"])
                    step += 1
                    emit(run_id, "step_started", step=step, goal=item["text"].strip().splitlines()[0])
            if (event["type"] == "item.completed" and item.get("type") == "mcp_tool_call"
                    and item.get("server") == "proofread" and item.get("tool") == "finish"):
                result = item.get("result") or {}
                structured = result.get("structured_content") or result.get("structuredContent") or {}
                if structured.get("finished") is True:
                    finished = True
                for content in result.get("content", []):
                    if content.get("type") == "text":
                        try:
                            finished |= json.loads(content["text"]).get("finished") is True
                        except (ValueError, AttributeError):
                            pass
            if event["type"] == "turn.completed":
                usage = event.get("usage", {})
                last = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
                cumulative += last
                checkpoint(run_id, tokens={"last_call": last, "cumulative": cumulative})
            if event["type"] in {"turn.failed", "error"}:
                failure = event.get("error", event.get("message", "Codex turn failed"))
            run = get_db().runs.find_one({"_id": run_id}, {"step": 1, "status": 1})
            if run["step"] >= MAX_STEPS:
                raise RuntimeError("Run event budget exhausted")
            if run["status"] != "running":
                raise RuntimeError(f"Run stopped with status {run['status']}")
        if not finished:
            raise RuntimeError(f"Codex exited without a successful finish tool call: {failure or 'incomplete workflow'}")


def get_executor(harness: dict, *, executor: str | None = None) -> Executor:
    if os.getenv("EXECUTOR", "codex") == "none" or executor == "none":
        raise ValueError("Live reconstruction is disabled")
    if (executor or os.getenv("EXECUTOR", "codex")) != "codex":
        raise ValueError("Only EXECUTOR=codex is implemented; ApiLoopExecutor is a future fallback")
    CliExecutor.validate(harness)
    return CliExecutor()
