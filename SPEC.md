# proofread — spec

Visualize agent reconstructions of molecular workflows from sequencing-protocol bundles, and collect human feedback on them. Benchmark results come from libstruct-bench. A component of LibStructGym.

## 0. Purpose

**One review, captured once, typed, fanning out to four destinations:**

| Destination | What the review becomes | Owner |
|---|---|---|
| This run | A repair: patched workflow, rescored | proofread |
| Memory | A verified entity or transition with provenance | cDNA |
| Harness | A signal → candidate patch → gate → version | proofread |
| Training data | A verified trajectory | LibStructGym (Aim 3) |

A UI action that cannot reach all four is under-typed. Benchmark visualization is a view over the same data; feedback capture is the product.

**Ecosystem**

| Piece | Role |
|---|---|
| libstruct-bench | Defines correct: tasks, ground truth, scorer |
| Hugging Face bundles | Frozen protocol documents + GT, pulled by Harbor |
| Harbor | Runs any executor × harness on the tasks at scale |
| cDNA | Skills and memory agents can call, via MCP |
| proofread | Review surface, review capture, gym loop |
| MongoDB Atlas | System of record: raw benchmark records, traces, harness lineage, verified memory, reviews |

**Working rules (both agents)**
- Backend agent owns `backend/`; web agent owns `web/`. Neither edits the other. Commit with explicit paths; never `git add -A`, never amend.
- §2 is the contract. Change §2 first, stop, get human approval, then code.
- One module per session; stop at the module's done-when test; commit with the module id.
- Molecules are symbolic (segments), never nucleotide strings.
- The executor never reads `ground_truth` and never writes `entities`.
- libstruct-bench is read-only. The importer reads `runs/` and nothing else.
- Walkthrough update (approved 2026-09-28): `seed.py` may also read the selected
  20 protocols' frozen task bundles, including source manifests and pinned
  source documents, to seed evidence chunks. Verify source hashes; never
  execute task code or change the benchmark checkout. The importer retains
  its `runs/`-only boundary.

## 1. Repo layout

```
SPEC.md                    this file
AGENTS.md / CLAUDE.md      agent scopes
fixtures/*.jsonl           event fixtures; permanent test data for the web side
backend/
  app.py                   routes
  db.py                    collections, indexes
  seed.py                  ingest(files, meta) → protocol, chunks, GT   (CLI: python -m backend.seed add <folder>)
  import_benchmark.py      libstruct-bench runs/ → benchmark_records + runs/events/workflows
  engine.py                emit(), checkpoint(), SSE
  harness.py               render(version) → instructions, tool list, guardrails
  executors/               CliExecutor (codex, claude, gemini), ApiLoopExecutor, none
  mcp_server.py            proofread tools; mounts cDNA tools
  skills.py, molecule.py   → move to the cdna package (M13); pure, no Mongo, no emit()
  verifier.py              GT-free checks + GT scorer (only file that opens ground_truth)
  reviewer.py              diagnosis → signal
  reviews.py               review capture + fan-out
  evolver.py, gate.py      candidate harness → regression gate
  editor.py                free text → structured patch
  Dockerfile               backend image for deployment
web/
  app/page.tsx             Start: protocols × systems
  app/runs/[id]/page.tsx   Review surface: canvas · trace · chat · inspector
  app/queue/page.tsx       Queue
  app/harness/page.tsx     Harness: lineage, gates, rejections
  app/memory/page.tsx      Memory: verified entities and provenance
  app/benchmark/page.tsx   Benchmark: scores by run, version, executor
  lib/events.ts, lib/reducer.ts, lib/api.ts, components/
```

Env (backend): `MONGODB_URI`, `EXECUTOR` (`codex | claude | gemini | api | none`), `CODEX_MODEL`, `STREAM_MODE` (`stream | poll`), `CORS_ORIGINS`, `REVIEW_TOKENS` (`token:name:role,…`).
Env (web): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STREAM_MODE`.

## 2. Contract (locked; changes require approval)

### 2.1 Molecules

```jsonc
// Segment
{ "name": "TSO", "type": "tso", "origin": "skill" }
// type ∈ adapter | barcode | umi | insert | primer | tso | handle | index | polyA | other
// origin ∈ source | skill | memory | llm | human

// MoleculeState
{ "id": "S4", "label": "cDNA + TSO",
  "strands": { "top": [Segment], "bottom": [Segment] },   // top 5'→3'; bottom 3'→5' aligned under top; [] if single-stranded
  "origin": "skill", "evidence": ["c18"], "skill_call_id": "sk_3",
  "review_status": "unreviewed",     // unreviewed | accepted | modified | rejected | unresolved
  "stale_since_revision": null }

// Transition — from → to is substrate → carried product
{ "id": "T3", "from": "S3", "to": "S4",
  "op": "template_switching",        // reverse_transcription | template_switching | pcr | fragmentation | ligation | tagmentation | other
  "skill_call_id": "sk_3", "evidence": ["c18"],
  "oligos": ["TSO"], "discarded": [] }

// Workflow (one per run)
{ "run_id", "protocol_id", "harness_version", "workflow_revision": 1,
  "states": [MoleculeState], "transitions": [Transition],
  "checks": [CheckResult], "gt_score": {"structure_f1": 0.69, "edge_f1": 0.46} | null,
  "benchmark_score": null | { "benchmark_version": "4.6.0",
                              "metrics": { "t2_required_family_f1": 0.77, "t3_molecular_transition_f1": 0.66,
                                           "t3_state_f1": 0.82, "t3_typed_edge_f1": 0.64 } } }
// benchmark_score.metrics: map of saved metric name → finite number, in its original units.
// The four metrics above illustrate a Task 2/3 record; other benchmark tasks have other keys.
// An unscored trial uses metrics: {} and benchmark_version: "unknown" unless a version is recorded.
```

An imported `MoleculeState` may also carry `benchmark_structure`: the native Task 3 state's structural fields projected to symbolic segments. Preserve `state_id`, `strand_architecture`, `reference_strand_id`, every strand's `strand_id`, `molecule_type`, `orientation`, and ordered segments, plus `paired_regions` and `discontinuities`. Each segment retains `segment_id`, `role`, `structural_role`, and optional `support_status`; omit nucleotide sequences, sequence-architecture strings, and free-text notes. Pairing and discontinuity references must resolve to preserved strands and segments. For these states, `strands.top` / `strands.bottom` are a preview of the reference strand and one partner; the UI indicates additional strands and exposes the full `benchmark_structure`.

`benchmark_score` holds the saved benchmark metrics under their original names. `t3_state_f1` includes reference-sequence scoring and is not `structure_f1`. `gt_score` stays null until proofread's verifier scores the run.

**M10 score extension — approved 2026-09-26:** Preserve the available saved metrics, including older library-structure metrics, without renaming, filling missing values with zero, or restricting values to [0, 1]. An imported trial without saved scores still emits `benchmark_scored` with an empty `metrics` object before `run_finished`; the UI labels it unscored. A record without a Task 3 graph has empty `states` and `transitions`; importing it does not reconstruct a graph.

### 2.2 Events

Append-only. `{ run_id, seq, ts, t, ...payload }`, `seq` per run from 1. Harness-level events carry the triggering `run_id`.

**M14 imported-run re-normalization — approved 2026-09-28.**

- The importer may map saved Harbor agent messages to `step_started`, recorded
  file reads to `evidence_searched`, and explicitly stated assumptions to
  `assumption`, using the existing payloads below. It reads only `runs/`, never
  executes trajectory commands, and omits nucleotide sequences and credentials
  from public excerpts. Store the mapped trace and source provenance in
  `benchmark_records` so normalization requires no checkout.
- Only runs with `source: benchmark | harbor` may be re-normalized. Rebuild
  the whole event stream from `benchmark_records` and its archived trajectory
  under the same `run_id`; never splice events into the existing stream.
  Emit trace events after `run_started` and before graph commits. Archive the
  original log and retain subsequent review/edit history when rebuilding.
  Replace the stream and its projection atomically through `emit()`, number
  `seq` contiguously from 1, and record `normalization_version` on the run.
- Preserve run IDs, source identity, workflow revisions, graph content, reviews,
  saved benchmark metrics, and verifier scores. State and transition IDs stay
  stable so existing reviews still resolve. Repeating the same normalization
  is a no-op. Live runs remain append-only without exception.
- Evidence follow-up (approved 2026-09-28): imported state commits with empty
  `evidence` inherit the unique chunk IDs from the three nearest preceding
  nonempty `evidence_searched` events, newest reads first. Adjacent commits
  share that context until another read occurs; no later read is used. Preserve
  existing citations and explicit review edits to evidence. During whole-stream
  re-normalization, only this evidence enrichment may change the saved graph;
  carry it through retained edits that left evidence unchanged. Review documents
  and their original before/after snapshots remain unchanged.
- Existing clients must reload and replay from `since=0` after re-normalization,
  because their previous sequence cursors refer to the original ordering.

| `t` | payload | emitted by |
|---|---|---|
| `run_started` | `protocol_id, harness_version, executor, source: live \| harbor \| benchmark` | engine / importer |
| `step_started` | `step, goal` | executor / importer |
| `evidence_searched` | `query, results:[{chunk_id, page, snippet}]` | executor / importer |
| `skill_called` | `skill_call_id, skill, inputs, result, error` | executor |
| `state_committed` / `transition_committed` | `state \| transition, workflow_revision` | executor / editor / importer |
| `state_revised` | `state_id, before, after \| null (removed), caused_by, workflow_revision, stale:[state_id]` | editor / reviews |
| `transition_revised` | `transition_id, before \| null (added), after \| null (removed), caused_by, workflow_revision` | editor / reviews |
| `assumption` | `text, state_id?` | executor / importer |
| `guardrail_blocked` | `tool, reason` | executor |
| `checkpoint` | `completed_states: string[], pending: string[], tokens: {last_call, cumulative}` | executor |
| `verifier_check` | `check, status, state_id?, message, evidence?` | verifier |
| `gt_scored` | `structure_f1, edge_f1` | verifier (human-facing: after run_finished for GT protocols, and in the gate) |
| `benchmark_scored` | `benchmark_version, metrics` | importer |
| `review_finding` | `signal_id, finding, operation, state_id, root_cause, recommended_action, harness_relevance` | reviewer |
| `review_recorded` | `review_id, target_id, decision, reviewer, note` | reviews |
| `human_message` | `text, mode` | api |
| `patch_proposed` / `patch_applied` | as before | editor |
| `harness_candidate` | `version, parent, patches` | evolver |
| `gate_result` | `version, sigma, results:[{protocol_id, role, before, after, delta}], decision, reason` | gate |
| `harness_promoted` | `version` | gate |
| `run_finished` | `status: done \| failed` | engine / importer — always last |
| `error` | `message` | any |

UI status: `reviewing` on first `verifier_check`, `done`/`failed` on `run_finished`.

### 2.3 Harness version

```jsonc
{ "_id": "v0", "parent_id": null,
  "status": "active",                 // active | candidate | promoted | rejected | superseded
  "rules": [], "guardrails": ["evidence_required"],
  "context_policy": { "evidence_k": 5, "history": "full" },   // history enforced by ApiLoopExecutor only
  "tool_access": { "reverse_transcribe": "available", "template_switch": "available" },  // off | available | mandatory
  "patches": [HarnessPatch], "source_signals": [], "eval": null | {...}, "created_at": "..." }

// HarnessPatch
{ "type": "tool_access | guardrail | rule | context_policy", "path": "...", "from": ..., "to": ..., "reason": "...",
  "scope": "template_switching" }     // required for rule; workflow-wide rules are rejected
```

Rendering of `mandatory` for op X: "if the protocol performs X, the product state must be constructed with the X skill; never add an operation the evidence does not support." The second clause is in the base prompt for every version.

### 2.4 Signal

```jsonc
{ "_id", "run_id", "protocol_id", "harness_version",
  "source": "verifier | reviewer | human",
  "signature": "<error_type>×<operation>",
  "error_type": "...",   // exact benchmark schema slugs: missing_recoverable_information | unsupported_completion | operation_error |
                         //   strand_or_orientation_error | molecular_state_or_assembly_error | workflow_or_topology_error
  "operation", "state_id", "evidence", "root_cause", "recommended_action",
  "harness_relevance": "high | low", "systematic": false,
  "proposed_patch": HarnessPatch | null, "review_id": null, "processed": false, "created_at" }
```

### 2.5 Review

```jsonc
{ "_id", "run_id", "workflow_revision", "target_id",       // state or transition id
  "decision": "accept | modify | reject | unresolved",
  "before": {...}, "after": {...} | null,                   // after present for modify; null for reject
  "error_type": null,                                     // §2.4 slug; required for modify/reject, null otherwise
  "note": "...", "reviewer": {"id": "...", "name": "...", "role": "curator | author"},
  "systematic": false, "created_at" }
```
Reviews are never overwritten; a later review of the same target is a new document.

**M11 review extension — approved 2026-09-26:** `error_type` is the reviewer's confirmed selection from §2.4's six categories. Modify/reject requests must supply it; accept/unresolved requests use null or omit it. An editor suggestion may prefill the selection when a model is available, but saving a review does not require a model or live executor. `EXECUTOR=none` disables live reconstruction and still permits authenticated review capture.

### 2.6 API

Write routes require `X-Review-Token`, resolved through `REVIEW_TOKENS` or a
stored author invite. Reads are public except curator-only `GET /invites`.

**Reviewer walkthrough and M15 — approved 2026-09-28:**

- `/runs/{id}/gt-diff` aligns by symbolic segment structure and operations/endpoints,
  never by matching IDs. Add `matched_states` and `matched_transitions`, each
  containing `{predicted, truth, similarity}` (full objects and a similarity
  from 0 to 1). `missing_states` / `extra_states` are unmatched GT / predicted
  states; add `missing_transitions` / `extra_transitions` for unmatched
  transitions. Retain `missing_edges` / `extra_edges` for typed-edge differences.
  Predicted objects use §2.1. GT states use `MoleculeState`; GT transitions use
  their native symbolic fields (`transition_id`, `operation`,
  `substrate_state_ids`, `product_state_ids`, `carried_forward_product_ids`,
  `discarded_product_ids`, `oligo_ids`) to preserve multiple endpoints.
- Public verifier checks display the check name as words and a plain message,
  without internal IDs or paths in those strings. Structured `state_id` and
  `evidence` fields remain available for navigation; saved event history stays intact.
- `/runs/{id}/messages` returns 501 when `EXECUTOR=none`, without invoking a
  model or writing run events. Typed reviews remain available.
- `POST /invites` accepts `{protocol_id, name}` and returns
  `{invite_id, protocol_id, name, role: author, token, created_at}`. Only a
  curator can create or list invites. Store a token digest; return the token
  only when it is created. `GET /invites` returns the same metadata without
  tokens or digests, newest first.
- `DELETE /invites/{id}` (approved 2026-09-28) accepts an `invite_id`, requires
  a curator, and deletes that invite so its token no longer authenticates.
  Return 204 with no body, or 404 if the invite does not exist. Retain reviews
  already attributed to the invite's author.
- Invite tokens resolve through `X-Review-Token` to an author with one
  `protocol_id`. All run write routes enforce that scope, returning 403 for
  another protocol. Creating runs also requires a review token and enforces
  the requested protocol's scope. Authors cannot import, change harnesses,
  or administer invites. Unscoped legacy author tokens have no write access.
  Other read routes remain public.

| Method | Path | Body → Response |
|---|---|---|
| GET | `/config` | `{executor, live_runs: bool, stream_mode}` |
| GET | `/protocols` | `[{id, name, family, role, has_gt, sources:[{run_id, source, executor, model, harness_version, benchmark_score?}]}]` |
| POST | `/runs` | `{protocol_id, harness_version?, executor?}` → `{run_id}`; 501 when `EXECUTOR=none` |
| GET | `/runs/{id}` · `/runs/{id}/events?since=` · `/runs/{id}/stream?since=&speed=` · `/runs/{id}/gt-diff` | as before |
| POST | `/runs/{id}/messages` · `/runs/{id}/patches/{pid}/apply` | as before |
| POST | `/runs/{id}/reviews` | `Review` minus id/created_at/reviewer → `{review_id, workflow_revision, derived: {signal_id?, memory_candidate_id?, gt_candidate_id?}}` |
| GET | `/runs/{id}/reviews` | `[Review]` |
| GET | `/queue` | `[{run_id, protocol, executor, harness_version, unreviewed_failed_checks, unresolved, score}]` sorted by need |
| GET | `/chunks/{id}` · `/harness` · `/harness/versions` · `/harness/versions/{v}` · `POST /harness/evolve` · `POST /harness/gate/{v}` | as before |
| GET | `/memory?operation=&type=` | `[Entity]` verified only |
| GET | `/benchmark?group_by=version\|executor\|protocol` | aggregated scores, `benchmark_score` and `gt_score` side by side |
| POST | `/import` | `{source: benchmark \| harbor, path}` → `{records: n, runs: n}` (local only) |
| POST | `/invites` | `{protocol_id, name}` → invite metadata plus one-time `token` (curator only) |
| GET | `/invites` | → invite metadata without tokens/digests (curator only) |
| DELETE | `/invites/{id}` | → 204; 404 if absent (curator only) |

### 2.7 Semantics

- **`evidence_required`**: `commit_state` rejects a state with empty `evidence` unless `origin ∈ {skill, human}`.
- **`provenance_required`**: every segment carries `origin`; an `llm`-origin segment in a state whose transition has a skill available is rejected.
- **`bottom_strand_3to5`**: `commit_state` / `revise_state` reject a detectably reversed bottom row (≥2 uniquely matched anchors in reversed order) with an explicit message; ambiguous rows are not silently repaired.
- **`tool_access = mandatory` for op X**: `commit_transition(op=X)` rejects unless `skill_call_id` references a successful `skill_called` for X.
- All guardrail rejections emit `guardrail_blocked`.
- `structure_f1` is orientation-tolerant (max over both bottom-strand listings); verifier checks are not.
- Stale: revising state S at revision r marks all downstream states `stale_since_revision = r`. Recompute is a queued task, not automatic.
- Ground truth isolation: only `verifier.py` opens `ground_truth`, called from `gate.py`, `/gt-diff`, or post-run scoring. Setup code and the importer may write it.
- Executor never writes `entities`. Only `reviews.py` (accepted items) and `gate.py` (promoted runs) do.
- Benchmark import emits `benchmark_scored` before `run_finished`, never relabels benchmark metrics, and never uses them as Gate baselines. Import is keyed on `(executor, model, harness_version, protocol)`; re-import updates, never duplicates. Normalization must be re-runnable from `benchmark_records` alone.
- **Imported-run re-normalization (M14, approved 2026-09-28):** only `source: benchmark | harbor` may have its entire event stream rebuilt from archived records and trajectory under the same `run_id`, per §2.2. Preserve state/transition IDs, reviews and applied edits, workflow revisions, and both score sets; record `runs.normalization_version` and make identical re-runs a no-op. Rebuild through `emit()` in one transaction, with trace events before commits. Never splice the existing stream or apply this exception to live runs; live event logs remain append-only.
- Imported evidence enrichment follows §2.2's approved nearest-read rule. All
  other graph fields and scores must match the saved projection before the
  replacement commits.

## 3. Data (MongoDB Atlas)

| Collection | Notes |
|---|---|
| `protocols` | name, family, role, has_gt, sources[], note |
| `chunks` | protocol_id, page, kind (page/table), text. No vector index. Text index on `text`. Retrieval is `list_sources` + `read_page` + text search. |
| `ground_truth` | isolated per §2.7 |
| `benchmark_records` | one per benchmark result file: `harbor_run_id, executor, model, harness_version, protocol_id, scorer_version` (or `unknown`), `raw` (the file as stored), `imported_at`. The archival copy; `runs/` on disk is a backup. |
| `harness_versions` | §2.3 |
| `runs` | + `source`, `executor`, `model`, `benchmark_record_id`, `parent_run_id`, `verified_through_revision` |
| `events` | unique (run_id, seq); change stream → SSE |
| `workflows` | §2.1 |
| `signals` | §2.4 |
| `reviews` | §2.5; append-only |
| `invites` | SHA-256 token digest as `_id`; invite_id, protocol_id, name, role author, created_at. No plaintext token. |
| `entities` | cDNA memory: name, type, aliases, operation, substrate, assay_family, verified, provenance {review_id \| run_id}, created_at |

Baselines: every protocol scored once per active version (`runs.baseline: true`); the gate compares against these.

## 4. Run sources

All three produce the same events and are indistinguishable to the UI.

| Source | How | What the trace contains |
|---|---|---|
| Live | `POST /runs` → executor → MCP tools; laptop only (`EXECUTOR` set) | full trace |
| Harbor import | `import_benchmark --source harbor` | trajectory mapped to trace events where the format allows; commits from the final record |
| Benchmark record | `import_benchmark --source benchmark` | commits, verifier checks from the error analysis, `benchmark_scored`; no trace |

## 5. Review fan-out (`reviews.py`)

On `POST /runs/{id}/reviews`, in one transaction:

1. **Repair.** `modify` → `state_revised` / `transition_revised`, revision bump, downstream stale, rescore if GT exists. `reject` → removal (`after: null`). `accept` / `unresolved` → `review_status` only.
2. **Signal.** `modify` or `reject` → one `signals` row: `source: human`, `error_type` confirmed or selected directly by the reviewer in the UI (editor suggestions may prefill it when available), `systematic` from the review.
3. **Memory candidate.** `accept` on a state or transition with evidence, or `modify` with `after` → `entities` row `verified: false, provenance: {review_id}`. Becomes `verified: true` only when the same entity is accepted in a second protocol or the curator marks it.
4. **GT candidate.** `modify` on a protocol with GT where `after` disagrees with GT → a GT correction record for curator adjudication.
5. **Trajectory tag.** `runs.verified_through_revision = r` once every failed check's target has a review; the training exporter (Aim 3) reads that.

Gate rule: promote if target mean Δ > 0 over ≥2 target runs, the triggering check passes on the target, and min regression Δ ≥ −σ, where σ = spread of the active version's replicate runs on the target protocol. Regression protocols are from families other than the target. Rejections are kept with reason.

## 6. Surfaces and roles

| Surface | Route | Shows |
|---|---|---|
| Start | `/` | protocol list; per protocol, one button per system with a result (executor + model + harness, from `sources`), each opening that run. "Run live" only when `/config.live_runs` |
| Review | `/runs/[id]` | canvas · trace · chat · inspector with accept/modify/reject/unresolved per item · score panel (`benchmark_score` and `gt_score`, labeled) · compare-with-GT · run again (when live) |
| Queue | `/queue` | runs needing a human, sorted by unreviewed failed checks and unresolved items |
| Harness | `/harness` | lineage, patches, gate tables, rejections |
| Memory | `/memory` | verified entities, provenance, which reviews created them |
| Benchmark | `/benchmark` | scores by version × executor × protocol; imported baselines alongside live runs |

| Role | Can |
|---|---|
| curator | everything, including verify memory, adjudicate GT candidates, promote (via gate only) |
| author reviewer | one protocol; accept/modify/reject/unresolved; invited by link (M15) |
| executor | run; no GT, no memory writes |

Reviewer identity (web): on first write, ask for name and token, keep in localStorage, send `X-Review-Token`.

## 7. Modules

Backend (Codex) and web (Claude Code) in parallel; web builds against fixtures first, then live.

**M12 — Drop vector search.** Remove the index and embedding calls; `search_evidence` → text search over `chunks`; keep `list_sources` + `read_page`. *Done when:* `python -m backend.db` initializes the new cluster with no embedding env vars and a live run completes.

**M10 — Benchmark importer.** Read only `../libstruct-bench/runs/`. Retain the original 20 native Codex baselines identified by the `libgen/codex/libgen-gpt-5-6-sol/result.json` job summary (scope narrowed by the user on 2026-09-26). Store their result files in `benchmark_records`; normalize per §4 keyed per §2.7; seed protocols and GT from the records. *Done when:* all 20 selected baselines appear in `GET /protocols` `sources` and replay with `benchmark_scored`.

**F11 — Start page.** Per §6. *Done when:* every imported baseline is one click from `/`, and "Run live" is hidden when `/config.live_runs` is false.

**M11 — Reviews, queue, benchmark, auth.** `reviews.py` per §5 steps 1–3 (4–5 flags only); `GET /queue`; `GET /benchmark`; `GET /config`; `EXECUTOR=none`; `X-Review-Token`. *Done when:* a curl review with a token lands in `reviews`, produces a signal and a memory candidate, and appears in the queue.

**F12 — Reviewer identity + live routes.** Token prompt; `/queue` and `/benchmark` read live routes. *Done when:* a review from the browser is attributed to the named reviewer.

**D1 — Deploy.** Per §10. *Done when:* the public URL opens an imported run and a review made there appears in Atlas.

**F9 — Queue polish · F10 — Memory and Benchmark views.** *Done when:* all render from live data.

**M13 — cDNA split.** `skills.py`, `molecule.py`, skill tools → `cdna` package with its own MCP server; proofread mounts it. *Done when:* a second MCP host can call `template_switch` without proofread.

**M14 — Harbor trajectory import.** Tool calls → trace events. *Done when:* a paper baseline run shows a trace, not just commits.

**M15 — Author review mode.** Curator creates/lists invites through `/invites`;
the token grants role `author` for one protocol. Every run write enforces the
scope. *Backend done when:* an author token can review its protocol and gets
403 on another.

Order: M12 → M10 → F11 → M11 → F12 → D1 → F9/F10 → M13 → M14 → M15.

## 8. Invariants

1. The harness is data; the run is an event log; UI state is `fold(events)`.
2. The executor never reads ground truth. The gate and human-facing scoring do.
3. Humans are authoritative; model findings are proposals.
4. Every artifact — state, segment, entity, patch — carries origin and provenance.
5. Nothing is promoted without a gate; rejections are kept.
6. Reviews are append-only; derived records point back to their review.
7. Runs from any source share one schema; benchmark metrics keep their original names.

## 9. Dropped

Vector search and embeddings; upload as a UI feature (CLI ingest remains); the harness strip (Harness surface replaces it); the hackathon demo script and timetable.

## 10. Deployment

Two deployables, one cluster.

- **Backend** — `backend/Dockerfile`, run on Fly.io or Render. Env: `MONGODB_URI`, `EXECUTOR=none`, `CORS_ORIGINS`, `REVIEW_TOKENS`, `STREAM_MODE`. No executor on the server: live runs happen on a laptop against the same Atlas cluster and appear on the site as `source: live`.
- **Web** — Vercel, root directory `web/`, env `NEXT_PUBLIC_API_URL`.

URL layout, decided by the inspection of `acolytics_web`:
- **A (default):** proofread's Next.js app becomes the acolytics.com root; landing page at `/`, app under `/proofread` via `basePath`. Backend at `api.acolytics.com`, called directly from the browser (CORS), never proxied through Vercel rewrites (SSE buffering).
- **B:** acolytics_web stays the root and adds a rewrite `/proofread/*` → the proofread deployment. Only if its host can proxy.
- Fallback: `proofread.acolytics.com` via DNS alone.

Atlas: Network Access allows the backend host's egress (or `0.0.0.0/0`); database user `proofread` with readWrite on `proofread`.
