# M13 — cDNA package and independent MCP host

Done-when passed on 2026-09-27.

## Implementation

- Source: `../cdna/cdna/`, committed as `3dcccfb` in the cDNA repository.
- Distribution: `cdna-engine @ git+https://github.com/seqmachines/cdna@v0.2.0`;
  imports use `cdna.molecule`, `cdna.skills`,
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

The original M13 check used a wheel built from the sibling source. The dependency
now installs directly from the Git tag, and the vendored wheel is removed.
The tag resolves to `3dcccfb016e1d0d2caa70e3d6f3dff6807f9b4a8`, the same source
commit used for the original check. Docker includes Git and CA certificates.

## Verification

`python -m backend.check_m13` originally passed using the installed wheel in proofread's
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
saved runs were preserved.

## Git dependency and deployment follow-up

`docker build --progress=plain -t proofread-backend:m13-git backend` passed with
the Git requirement and no vendored wheel. The image's installed distribution
metadata confirms version `0.2.0`, requested revision `v0.2.0`, and commit
`3dcccfb016e1d0d2caa70e3d6f3dff6807f9b4a8` from the GitHub cDNA repository.

`backend/deploy.sh` deployed to the acolite project (`gen-lang-client-0325887617`)
in `us-east4`. Cloud Build `9d966181-eae2-421b-8682-bc3d95394ed1` succeeded;
revision `proofread-api-00002-zdw` is ready and serves 100% of traffic. The
existing service environment settings were preserved in the ignored private
`backend/.env.cloudrun` file.

Public checks passed at `https://proofread-api-7jj27cadja-uk.a.run.app`:

- `/config`: `executor: none`, `live_runs: false`, `stream_mode: stream`.
- `/protocols`: 20 protocols, each with its Codex benchmark source.

## v0.2.1 deployment and baseline scoring — 2026-09-28

`backend/requirements.txt` now pins
`cdna-engine @ git+https://github.com/seqmachines/cdna@v0.2.1`.
Local and Docker distribution metadata both resolve that tag to
`6c3af694c296952d517cef77c74199a05e2f323c` and report version `0.2.1`.
There was no remaining wheel in `backend/vendor/` to delete.

`docker build --progress=plain -t proofread-backend:cdna-v0.2.1 backend`
passed. `backend/deploy.sh` completed with Cloud Build
`e7487131-db8d-4f09-931f-380d7233cff9`. Cloud Run revision
`proofread-api-00003-n66` is ready and serves 100% of traffic in the existing
project and region. Public checks passed:

- `/config`: `executor: none`, `live_runs: false`, `stream_mode: stream`.
- `/protocols`: 20 protocols and 20 imported sources.
- All 20 public run snapshots have both `gt_score` and `benchmark_score`.
- `/benchmark?group_by=version`, `executor`, and `protocol` each account for
  20 scored runs; the protocol grouping contains 20 rows.

All 20 retained baselines were scored with `verifier.compare_ground_truth()`.
Each score was persisted through `emit(gt_scored)` followed by
`emit(run_finished)` in one transaction. Existing event prefixes, molecular
graphs, saved benchmark metrics, workflow revisions, and the existing human
review were verified unchanged. Imported runs were not marked as Gate baselines.

Public `/benchmark?group_by=executor` reports mean `structure_f1 = 0.67816515`
and `edge_f1 = 0.6956088`, with `gt_scored_runs = 20`. Its separate benchmark
score remains version `4.6.0`, including mean `t3_state_f1 = 0.6713298263853551`
and `t3_typed_edge_f1 = 0.7536018460517834` under their original names.
