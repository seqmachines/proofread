# M14 — Harbor trajectory import

Done-when passed on 2026-09-28.

## Contract and implementation

The human approved re-normalization in SPEC §2.2 and §2.7 for
`source: benchmark | harbor` only. Live runs remain append-only.

- Rebuild the complete stream under the existing run ID through `emit()` in
  one transaction; do not splice into the old stream.
- Store `normalization_version: m14.1` and archive the original stream in
  `benchmark_records.normalization.original_events`.
- Put agent messages and recorded file reads before final graph commits.
  Map explicitly stated assumptions only. The selected panel contains no
  affirmative assumption statements matching that rule; none were invented.
- Preserve graph IDs, workflow revisions, both score sets, and human history.
  The engine rejects a rebuild whose resulting workflow differs from the
  current reviewed projection. The importer and engine each reject live runs.
- Store mapped trace text and evidence chunks with trajectory source hashes in
  `benchmark_records`. No benchmark files outside `runs/` are read, and no
  trajectory command is executed.

## Verification

```sh
backend/.venv/bin/python -m backend.check_m14 \
  --base https://proofread-api-7jj27cadja-uk.a.run.app
```

Result: **M14 DONE-WHEN PASSED**.

- All 20 selected baselines re-normalized: **139 `step_started`** and
  **529 `evidence_searched`** events, all before graph commits.
- All 20 workflows, saved metrics, verifier scores, state/transition IDs, and
  the existing review were unchanged. Related entities and signals were also
  unchanged. Original event logs were archived exactly.
- Evidence chunk references resolve. Recorded SMART-seq supplement text includes
  template switching and its recorded page.
- Normalization passed with benchmark filesystem reads disabled; repetition
  changed zero runs or event sequence counters.
- An explicit assumption mapped in the safety check; a negated assumption and
  a file write did not. Sequence and credential examples were redacted.
- A temporary live run was refused by both entry points with its log unchanged;
  the temporary run, workflow and events were removed afterward.
- The public event endpoint and SSE replay returned the same SMART-seq stream.
  The actual web reducer produced **8 trace steps, 11 states**, status `done`,
  `structure_f1 = 0.724611`, and `edge_f1 = 0.777778`.
- Public `/benchmark` still reports all 20 verifier-scored runs alongside
  the saved benchmark metrics.

Paper baseline: `a5a60a6e623357648a4d11a26ae5ad17` (`smart_seq`).
[Workbench](https://www.acolytics.com/proofread/runs/a5a60a6e623357648a4d11a26ae5ad17)
(HTTP 200).
[Public events](https://proofread-api-7jj27cadja-uk.a.run.app/runs/a5a60a6e623357648a4d11a26ae5ad17/events).

Browser visual QA was unavailable because no browser was connected. API, SSE,
evidence resolution and web reducer checks passed. No files under `web/` were
edited. Existing tabs must reload to replay the rebuilt stream from `since=0`.

## Deployment

`docker build --progress=plain -t proofread-backend:m14 backend` passed.
Cloud Build `f18157b6-0f4e-42f2-8251-76f29ae26fac` succeeded, and
`backend/deploy.sh` deployed revision `proofread-api-00004-m54` in project
`gen-lang-client-0325887617`, region `us-east4`, serving 100% of traffic.
The deployment script's public `/config` and `/protocols` checks passed.
