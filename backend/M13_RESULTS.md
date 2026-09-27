# M13 — cDNA package and independent MCP host

Done-when passed on 2026-09-27.

## Implementation

- Source: `../cdna/cdna/`, committed as `3dcccfb` in the cDNA repository.
- Distribution: `cdna-engine==0.2.0`; imports use `cdna.molecule`, `cdna.skills`,
  and `cdna.tools`. Existing cDNA oligo-extraction code and CLI are retained.
- Proofread's former `molecules.py` and `skills.py` implementations are removed.
  Proofread-specific request/benchmark models remain in `tool_models.py`.
- Standalone entry point: `cdna-mcp` or `python -m cdna.mcp_server`, stdio.
  It exposes `reverse_transcribe` and `template_switch` with no database,
  proofread, ground-truth, or model dependency in their import graph.
- Proofread mounts the package's tool schemas, applies harness restrictions,
  requires committed substrates, and emits skill provenance before commits.
  `run_skill` remains available and calls the same implementation.
- MoleculeState and Transition JSON schemas match the previous schemas exactly.
  No §2 changes were made.

The wheel in `backend/vendor/` is built from the sibling source and is included
in Docker and Cloud Build uploads. Its SHA256 is
`1dc74133c7e06670b0a8fc1499eba36e68958e6244aefa9e2df06b71f0c57306`.

## Verification

`python -m backend.check_m13` passed using the installed wheel in proofread's
Python 3.11 environment and Claude Code **2.1.283**.

1. The real proofread stdio MCP server exposed cDNA's schemas, constructed and
   committed three states and two transitions, retained the legacy adapter,
   rejected a forged substrate and a disabled skill, and preserved matching
   `skill_called` events and state `skill_call_id` values.
2. `claude -p` ran in an empty directory with `--strict-mcp-config`, only the
   cDNA MCP server, no built-in tools, and database/run environment variables
   removed. Its transcript contained an actual `mcp__cdna__template_switch`
   tool call and successful result:
   - Model: `claude-opus-5-5` (the CLI default; not hardcoded by the check).
   - Product: `S_9be5dad09370`.
   - Bottom strand: `TSO handle`, `transcript`, `RT primer`, listed 3′→5′.
3. Docker built from `backend/` alone installed the bundled wheel and served
   `/config` and `/protocols` against Atlas with `PORT=8080`, `EXECUTOR=none`,
   and all 20 protocols present.

The machine's existing Claude 2.1.220 has the documented MCP startup race in
print mode. A temporary native CLI 2.1.283 installation was used for the passing
check and removed afterward; the global CLI was not changed. Re-running the
check requires Claude >=2.1.221 and a working login. The check rejects prose
that merely claims a tool call succeeded.

All synthetic runs/chunks and temporary containers were removed. Existing
saved runs were preserved. M13 was not deployed to the live Cloud Run service.
