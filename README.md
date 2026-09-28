# proofread

Human review of agent-reconstructed sequencing-library workflows, and the loop that turns each
review into a repair, a memory entry, a harness change, and training data. A component of
LibStructGym.

An agent reads a library-prep protocol and reconstructs it as a chain of symbolic molecules:
each state is two strands of typed segments (adapter, barcode, UMI, insert, primer, TSO, handle,
index, poly(A)), each transition an operation (reverse transcription, template switching, PCR,
fragmentation, ligation, tagmentation). proofread shows that reconstruction next to its
evidence and verifier checks, and lets a human decide, per molecule, whether it is right.

## Every review fans out four ways

A decision is captured once (`POST /runs/{id}/reviews`) and, in one transaction, becomes:

| Destination | What the review becomes |
|---|---|
| This run | A repair: `modify` rewrites the state and marks everything downstream stale; `reject` removes it; the run is rescored when ground truth exists |
| Harness | A signal (`source: human`, with the error category the reviewer chose) that can drive a candidate harness change through the regression gate |
| Memory | A candidate entity for cDNA memory, verified once the same entity is accepted in a second protocol or a curator marks it |
| Training data | A trajectory tag once every failed check's target has a review, read by the training exporter |

Reviews are append-only; derived records point back to the review that created them.

## Surfaces

| Route | Shows |
|---|---|
| `/` | Protocols; per protocol, one button per system with a result (executor · model · harness), each opening that run. "Run live" only where a local executor is configured |
| `/runs/{id}` | The review surface: workflow canvas, agent trace, chat, and the inspector with accept / modify / reject / unresolved per molecule; compare with ground truth; replay |
| `/queue` | Runs needing a human, sorted by unreviewed failed checks and unresolved items |
| `/harness` | Harness lineage: versions, patches, gate tables, rejections |
| `/memory` | Verified entities with provenance and the review that created each |
| `/benchmark` | Scores by version × executor × protocol: proofread's `gt_score` and the record's `benchmark_score` side by side |

The app is served under `/proofread` (see `web/next.config.ts`); the backend is called directly
from the browser.

## Run locally

Backend (FastAPI, MongoDB Atlas):

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # MONGODB_URI, EXECUTOR (codex | claude | gemini | api | none),
                            # STREAM_MODE, CORS_ORIGINS, REVIEW_TOKENS (token:name:role,…)
cd .. && set -a && . backend/.env && set +a
backend/.venv/bin/uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000
```

Web (Next.js):

```bash
cd web
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL (default http://localhost:8000)
npm run dev                 # http://localhost:3000/proofread
```

`npm run build && npm run start` serves the production build at the same path.
`npm run check:fold` folds the fixtures through the reducer as a smoke test. The fixtures under
`fixtures/` replay without a backend at `/proofread/runs/fixture`, `/runs/fixture-loop` and
`/runs/fixture-benchmark`; their links appear on the start page on localhost only.

## Import benchmark runs

Benchmark result files from `../libstruct-bench/runs/` are archived in `benchmark_records`,
normalized into runs and events, and seeded with their protocols and ground truth:

```bash
set -a && . backend/.env && set +a
backend/.venv/bin/python -m backend.import_benchmark --source benchmark ../libstruct-bench/runs
```

Each imported run keeps the record's own metrics under their original names
(`benchmark_scored`), never relabeled as proofread's `structure_f1`. Imports are keyed on
(executor, model, harness version, protocol), so re-importing updates rather than duplicates.
`POST /import` does the same from a local curator session.

## Review a run

1. Open a protocol's run from `/`. Finished runs open complete; **replay** (or `r`) animates the
   reconstruction at 8×.
2. Click a molecule. The inspector shows its strands with per-segment origin, where it came
   from (skill call or transition, evidence chunks), the checks that failed on it, and its
   ground-truth status after **compare with ground truth**.
3. Decide: **accept**, **modify**, **reject**, or **unresolved**, with an optional note and
   "this will recur" when the mistake is systematic. Modify and reject require an error
   category, one of the six benchmark slugs. Modify seeds the chat with the molecule; describe
   the fix, then apply the resulting patch card, which records the review.
4. The first decision asks for your name and a review token from the curator; both stay in the
   browser. Reading and replaying never need a token.

Invariants (SPEC.md §8): the run is an event log and UI state is `fold(events)`; the executor
never reads ground truth; humans are authoritative and model findings are proposals; every
artifact carries origin and provenance; nothing is promoted without a gate.
