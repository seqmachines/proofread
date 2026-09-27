"""Run-scoped MCP server mounting cDNA tools through proofread's event adapter.

harness.render supplies cDNA's schemas; AgentTools enforces substrate/permission
checks and emits skill_called for both mounted tools and the run_skill adapter.
All stdout is reserved for MCP JSON-RPC.
"""

import asyncio
import json
import os

import anyio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, TextContent, Tool

from agent import AgentTools
from db import get_db
from harness import render


async def main():
    run_id = os.environ["RUN_ID"]
    version = os.environ["HARNESS_VERSION"]
    harness = render(version)
    if int(os.environ["EVIDENCE_K"]) != harness["evidence_k"]:
        raise ValueError("EVIDENCE_K differs from the selected harness")
    run = get_db().runs.find_one({"_id": run_id})
    if not run or run["harness_version"] != version or run["status"] != "running":
        raise ValueError("RUN_ID must reference a running instance of HARNESS_VERSION")
    agent = AgentTools(run_id, harness)
    server = Server("proofread")
    lock = asyncio.Lock()

    @server.list_tools()
    async def list_tools():
        return [Tool(name=t["function"]["name"], description=t["function"]["description"],
                     inputSchema=t["function"]["parameters"]) for t in harness["tools"]]

    @server.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        # Validate inside dispatch so invalid calls also emit guardrail_blocked.
        async with lock:
            result = await anyio.to_thread.run_sync(agent.dispatch, name, arguments)
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(result))],
                              structuredContent=result, isError=bool(result.get("error")))

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
