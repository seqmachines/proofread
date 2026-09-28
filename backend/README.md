# proofread backend

Requires Python 3.11. Run from this directory:

```sh
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# Fill in MONGODB_URI, EXECUTOR=codex and CODEX_MODEL in .env.
cd ..
backend/.venv/bin/python -m backend.db
```

The database name is `proofread`. Setup creates the eleven collections in
SPEC.md §3, their indexes, the `chunks_text` text index, and harness `v0` with
full history. Repeating setup preserves documents and harness status. Existing
vector indexes on `chunks` and stored vectors are removed during migration.
No embedding service, credentials, or model settings are needed for retrieval.
`setup_db.py` remains a compatible setup entry point; runtime imports of `db`
do not import setup code or access ground truth.

Subsequent commands below run from `backend/` unless specified otherwise.

## M12 text retrieval

From the repository root:

```sh
backend/.venv/bin/python -m backend.db
backend/.venv/bin/python -m backend.seed
backend/.venv/bin/python -m backend.check_m12
```

The M12 check requires no `EMBED_*` or `VOYAGE_*` environment variables. It checks
the indexes and protocol isolation, then reconstructs Smart-seq2 through the real
Codex MCP executor with verifier and reviewer hooks. Evolution is disabled for
this retrieval check so it does not start a separate Gate experiment.

Evidence tools are restricted to the current run's protocol:

- `list_sources({})`: source filenames with each page or sheet's `chunk_id`,
  `page`, and `kind`.
- `read_page({"chunk_id": "…"})`: full page/table text as
  `{chunk_id, page, snippet}`; unknown and other-protocol IDs are rejected.
- `search_evidence({"query": "template switching oligo"})`: matching chunks in
  text relevance order, with stable IDs breaking ties. Quoted phrases are
  supported. Search and page reads emit the existing `evidence_searched` event.

The compound index starts with `protocol_id`, followed by the `text` field;
every query supplies the protocol filter. Ranking uses MongoDB's
[`$text` / `textScore`](https://www.mongodb.com/docs/manual/reference/operator/query/text/).

## M0 done-when check

Start a watcher, wait for `READY`, then insert from a second terminal. Use the
same fresh probe ID in both commands:

```sh
.venv/bin/python check_m0.py watch m0-example
.venv/bin/python check_m0.py insert m0-example
```

The watcher must print the inserted event and exit successfully. If the Atlas
tier rejects change streams, set `STREAM_MODE=poll` in `.env` and repeat.
This probe does not create a workflow or run reconstruction.

Verified on Atlas on 2026-09-26: the change-stream watcher printed the event
inserted by the second process (`m0-20260926-1131`, `seq: 1`); both exited 0.

## M1 seed and evidence search

The approved local sources are in `../protocols-test/protocols/<slug>/`, with
native Task 3 annotations in
`../protocols-test/ground_truth/<slug>/groundtruth_library_generation_workflow.json`.
`libstruct-bench/schemas/groundtruth/library_generation_workflow.schema.json`
documents the native format. No dataset download is needed.

| Protocol | Family | Role |
| --- | --- | --- |
| `smart_seq2` (A) | template_switching | dev |
| `smart_seq3` (B) | template_switching | dev |
| `cel_seq2` | ivt | dev |
| `sci_rna_seq` | combinatorial_indexing | regression |
| `plate_scatac_seq` | atac | regression |
| `smart_seq3xpress` | template_switching | transfer |

Each `seed/<protocol>/` contains:

- `meta.json`: `name`, `family`, `role` (`dev`, `regression`, or `transfer`),
  and optional `id` (defaults to the folder name).
- `ground_truth.json`: an unchanged copy of the native Task 3 record.
- `source/`: original source files, ignored by Git.
- `text/`: generated evidence text, ignored by Git.

`seed.py` uses PyMuPDF for one chunk per PDF page, creates one Markdown chunk
per XLSX sheet with `kind: "table"`, and groups DOCX text into ten nonempty
paragraphs per chunk. For XLSX, `page` is the sheet number; for DOCX it is the
paragraph-block number, not a Word-rendered page. Original filenames and page,
sheet, or paragraph locators are included in the evidence text.

Setup imports all roles; the transfer protocol is reserved for the demo.
Long nucleotide strings in source pages are omitted from retrieval text.
Each protocol's `source_note` is exactly:
`LibStructBench (Poon et al., 2026), protocol text and ground truth`.

Set `MONGODB_URI` and initialize the database before seeding. Source extraction
and text retrieval need no model provider.

```sh
.venv/bin/python seed.py --source-root /Users/seqmachines/playground/protocols-test
# Subsequent imports can reuse the local source folders:
.venv/bin/python seed.py
.venv/bin/python check_m1.py --protocol smart_seq2 --chunk smart_seq2:SMART-seq2_TSO_table.xlsx:sheet01
```

Chunks have stable IDs `<protocol_id>:<source_filename>:<page_or_sheet_or_paragraphs>`.
Seed writes upsert those IDs.
Search uses MongoDB text search filtered by `protocol_id`, returning
`{chunk_id, page, snippet}`. The text index is ready when initialization returns.

Verified on Atlas on 2026-09-26: six protocols, 269 chunks, and six converted
ground truths were seeded. The M1 query returned
`smart_seq2:SMART-seq2_TSO_table.xlsx:sheet01` as its first result; the done-when
check exited 0. Native Task 3 copies match the local benchmark files byte for
byte. The transfer protocol was not used for retrieval or reconstruction.

### Native Task 3 conversion

`seed.py` converts `workflows[].states` and `workflows[].transitions` in memory.
It preserves state IDs, uses segment role descriptions as symbolic names, and
maps roles to §2.1 segment types. Sequence fields, pairing regions, and gap
annotations are omitted from the simplified display representation. M4 also
stores `scoring_workflows`: native architecture, ordered roles, pairing, gaps,
support labels, oligo links, and product dispositions, with all sequence fields
excluded. Older `final_state_ids` become the current schema's `final_outputs`.
RNA templates are
placed on top of hybrids; other states use the native reference strand as top.
Bottom-strand segments are reversed from native 5′→3′ order to the contract's
3′→5′ order. Ground-truth evidence arrays are empty because native Task 3 does
not supply chunk citations.

Explicitly named template-switching transitions become `template_switching`.
Operations outside §2.1 become `other`; multi-product transitions become one
edge per substrate/carried-product pair. Discarded products remain states and
are linked through `discarded`. `oligos` preserves the native Task 2 identifiers
as symbolic names; Task 3 alone does not contain a Task 2 display-name catalog.
The native JSON files are preserved for audit. To update converted ground truth
without extracting the source text again, run `.venv/bin/python seed.py --ground-truth-only`.

Creating, indexing, and seeding `ground_truth` are setup-only writes authorized
by the user. Runtime ground-truth reads remain reserved for `verifier.py` via
the gate or GT-diff route. `evidence.py` never reads ground truth.

## M2 run engine and SSE

From the repository root, start the API on port 8000:

```sh
backend/.venv/bin/uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000
```

CORS permits `http://localhost:3000`. M2 provides:

- `GET /runs/{id}`: the run and workflow snapshots.
- `GET /runs/{id}/events?since=0`: events after `since`, ordered by `seq`.
- `GET /runs/{id}/stream?since=0&speed=1`: stored events followed by live SSE.
  `speed>1` adds `1/speed`-second gaps while replaying stored events.

`engine.create_run()` emits `run_started`. `engine.emit()` increments `runs.step`
with `find_one_and_update`, appends the event, and applies its snapshot changes
in a MongoDB transaction. Sequence numbers start at 1. Checkpoints record the
committed state IDs, pending work, and token counters. State/transition commits
update the workflow through `emit()`; revision mismatches and duplicate IDs
abort the transaction. No model calls are made in M2.

The SSE route opens a Motor change stream before replay and drops overlapping
events by sequence number. Reads for replay, polling, and snapshots use sync
PyMongo; blocking reads in the async stream run in a thread pool. Set
`STREAM_MODE=poll` for the M0 fallback. A failed change stream also falls back
to polling from the last delivered sequence number. SSE stays open after
`run_finished` so later harness events can still appear in the trace.

### M2 done-when check

With the API running, use a second terminal:

```sh
backend/.venv/bin/python backend/check_m2.py
```

The check creates a fake `m2-probe` run with two stored events, opens `curl -N`,
and then emits eight live events. It prints all ten SSE events and checks their
sequence, the `since` polling cursor, and the resulting checkpoint/workflow.
The fake run remains in Atlas for inspection; it is not a protocol baseline.

Verified on Atlas on 2026-09-26 with run
`8d7709bb2c004027be44a9a3a5b10d60`: `curl -N` received seq 1–10 in order,
including the eight events emitted after replay began. Polling after seq 8
returned events 9 and 10. The run ended `done` with two states, one transition,
and a checkpoint containing both state IDs. The check exited 0.

## M3 Codex executor and symbolic tools

Set `EXECUTOR=codex` and `CODEX_MODEL=gpt-6-luna` in `backend/.env`.
Keep `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` empty. Install the Codex CLI
and sign in with ChatGPT on this machine. The executor reuses that login;
it does not copy or expose authentication files. The local CLI model catalog
lists Luna as its fast model. `CODEX_MODEL` selects the model explicitly.
The CLI uses low reasoning effort for these reconstruction runs.

Start the API as above, then run the M3 check:

```sh
backend/.venv/bin/python backend/check_m3.py
```

This starts Smart-seq2 on `v0` through `POST /runs`, watches its live SSE trace,
and requires `run_finished` with status `done` and at least five stored states.
The script prints the run ID, state/transition counts, token usage, and tool
failures. Runs remain in Atlas for replay and comparison.

### Execution boundary

`Executor` defines the transport interface; `CliExecutor` implements it using
`codex exec`. The flags were checked against installed CLI 0.155.1:
`--json`, `--ephemeral`, `--sandbox read-only`, `--ignore-user-config`,
`--skip-git-repo-check`, `--model`, and `--cd`. Each run gets a fresh temporary
directory. `harness.render()` writes its rules, guardrails, adapted benchmark
task instructions, and current task to `AGENTS.md` there.
See the official [non-interactive CLI documentation](https://developers.openai.com/codex/noninteractive)
and [MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp)
for the output stream and per-tool approval settings.

The CLI receives only the `proofread` stdio MCP server, with approval scoped
to its seven run-bound tools. Shell tools, web search,
apps, hooks, and subagents are disabled. The subprocess environment excludes
API keys and the Mongo URI; the MCP server loads backend credentials itself.
`mcp_server.py` validates `RUN_ID`, `HARNESS_VERSION`, and `EVIDENCE_K` before
exposing the enabled M3 tools. MCP calls are serialized. Model-generated shell
commands cannot read local benchmark annotations. Database setup was moved to
`setup_db.py`, so `agent.py` has no import path to setup or annotation code.

Codex manages its internal message history. With user approval, the unused
`v0` baseline was changed to the contract's existing `history: full` policy.
The CLI executor rejects `state_only` explicitly; an `ApiLoopExecutor` can
implement that policy later. CLI transport uses the existing event types.

Completed CLI agent messages become `step_started` events. All tool mutations
use `emit()`; every completed tool call produces a checkpoint. CLI
`turn.completed` usage supplies the token counters: `last_call` is the total
input + output usage for that CLI turn, and `cumulative` sums those turns.
The CLI does not expose per-internal-request usage in this JSON stream.

`finish` requests completion. After a successful process exit, `runner.py`
invokes the verifier, reviewer, and M7 evolution hook, then emits `run_finished`.
M4 supplies the GT-free verifier by default; M6 reviews its failures automatically.
Normal reconstruction does not score ground truth. Process errors, missing successful `finish`, a
ten-minute timeout, or the 200-event budget produce a failed run.

### Tools and provenance

The server exposes `search_evidence`, `run_skill`, `commit_state`,
`commit_transition`, `revise_state`, `assume`, and `finish`. Disabled skills
are removed from the tool schema; mandatory skills add prompt instructions
and are enforced when committing their transitions. Evidence IDs must belong
to the current protocol. Skills return uncommitted states with recorded
provenance; the agent must commit the returned state unchanged. A claimed
skill call must match the operation, substrate, and exact product.

`reverse_transcribe` produces an RNA/cDNA hybrid with the primer-derived
segment at the bottom strand's 5′ end (right). `template_switch` adds a
TSO-derived segment at the cDNA 3′ end (left), because the bottom row is
displayed 3′→5′. Neither performs nucleotide sequence calculations.
Revising a state bumps the workflow revision and marks every downstream state
stale through one `state_revised` event and its transactional projection.

The base prompt adapts the chronological reconstruction instructions from
LibStructBench's `benchmarks/libgen/tasks/smart_seq/instruction.md` and
`environment/rules.md`. Its sequence-level output requirements are replaced
with proofread's symbolic schema. No benchmark code or prior answers are
imported into the runtime.

M3's done-when check and two independent Smart-seq2 repeats passed on
2026-09-26. See [M3_RESULTS.md](M3_RESULTS.md) for run IDs, observed failures,
and their reproducibility.

## M4 verification and existing-run scoring

From the repository root, using the backend virtual environment:

```sh
source backend/.venv/bin/activate
python -m backend.verify eb714aed407a42439a02faf9a9151f1d
python -m backend.verify eb714aed407a42439a02faf9a9151f1d --export fixtures/run_example.jsonl
python backend/check_m4.py eb714aed407a42439a02faf9a9151f1d
```

The CLI goes through `gate.evaluate_existing()`. Only `verifier.py` reads
`ground_truth`; the other authorized caller is `GET /runs/{id}/gt-diff`.
That route returns missing/extra symbolic states and typed edges, or 404 when
GT is absent. The agent's import graph reaches neither verifier nor gate.

Five GT-free checks use committed states, transitions, retrieved source chunks,
and recorded skill results: connectivity, endpoint existence (including
discarded products), oligo representation, strand order, and provenance.
The oligo recognizer covers named source aliases, simple prose declarations,
explicit `Transition.oligos`, and skill inputs. It is a deterministic recognizer,
not a complete natural-language oligo extractor. Compound segment descriptions
remain single segments. These checks can miss information hidden in free text.

Every check emits `verifier_check`, appends to `workflows.checks`, and puts the
run in `reviewing` through the event transaction. A Gate evaluation emits
`gt_scored` with `structure_f1` and `edge_f1`; the same transaction updates
`workflows.gt_score` and marks scored `v0` runs `baseline: true`.
The runner emits `run_finished` after checks and review.

Retroactive scoring preserves the original M3 completion event and appends five
checks, one score, and a new terminal event. An unchanged, already scored run is
not appended again. `--export` writes the exact stored events ordered by `seq`.
Consumers should replay through the latest event, including past an earlier
`run_finished`. No review or promotion events are fabricated for this fixture.

M4 passed for all three original M3 runs. Scores, the selected fixture, metric
definitions, and validation are recorded in [M4_RESULTS.md](M4_RESULTS.md).

## M6 review and orientation handling

Each review makes one tool-free Codex turn with the configured `CODEX_MODEL`,
existing ChatGPT login, read-only sandbox, web disabled, and an empty working
directory. It supplies failed checks, their source evidence, the last 20
eligible events, current symbolic states/transitions, and harness settings.
GT scores, GT diffs, and Gate events are excluded. The reviewer has no MCP tools,
shell access, database credentials, or import path to the GT reader.
`--output-schema` and `--output-last-message` provide the structured response,
as documented in [OpenAI's non-interactive CLI guide](https://learn.chatgpt.com/docs/non-interactive-mode).

The response is validated against the six §2.4 categories and four §2.3 patch
types. Unknown paths, unscoped rules, CLI history changes, stale `from` values,
and invented state/evidence IDs are rejected. Each signal and corresponding
`review_finding` are saved in one event transaction. The reviewer does not
repair molecules. M7 consumes eligible signals before the runner finishes.

For an existing verified run, from the repo root with the venv active:

```sh
python -m backend.review eb714aed407a42439a02faf9a9151f1d
python backend/check_m6.py eb714aed407a42439a02faf9a9151f1d
```

An unchanged completed review is reused. `--force` deliberately requests another
review. Matching pending reviewer proposals keep their signal IDs and receive
new `review_finding` events; old event text remains in history. Processed or
human-confirmed signals cannot be replaced. The latest event for a signal ID
describes its current diagnosis.

`structure_f1` now takes the better score over both bottom-row listing directions,
including state assignment. The top row and symbolic content are unchanged.
The verifier still flags a reversed bottom row. Its exact observed/expected
anchor order and producing operation are supplied as deterministic facts the
reviewer must preserve under `strand_or_orientation_error`.

The opt-in `bottom_strand_3to5` guardrail rejects both commits and revisions whose
distinct, uniquely matched anchors prove a 5′→3′ bottom listing. Its error names
the bad direction and asks for the required 3′→5′ display. Single-stranded,
symmetric, or insufficiently matched rows do not establish a direction and are
not rejected on that basis. The guardrail is absent from `v0`; M7 can evaluate
its signal as a candidate independently of mandatory template switching.

M6 passed on the selected Smart-seq2 run. See [M6_RESULTS.md](M6_RESULTS.md) for
signal IDs, scores, and the refreshed real fixture.

## M7 Evolver and Gate

The runner evolves high-relevance proposals or systematic human signals after
review. Each tool-free Codex call receives one signal and the active harness,
with no GT or scores. It produces validated patches. Candidate creation and
signal consumption are projected atomically from `harness_candidate`.

The selected Smart-seq2 run has two independent candidates: first mandatory
`template_switch` plus `provenance_required`, then `bottom_strand_3to5`. The
second inherits the active version after the first Gate decision. Existing
guardrails are preserved. Only the four contract patch types are recognized;
M7 CLI candidates enable tool access, guardrails, and operation-scoped rules.
Context-policy patches are rejected for this executor. Appended rules must
carry `scope` and begin with `[operation]` so their scope reaches the prompt.

The Gate compares each candidate with fixed stored **v0** baselines, per §3.
For a v0 triggering run, that exact run is the target baseline. Other protocols
use their earliest completed, scored v0 baseline. Each candidate gets one run
on its target and the two regression protocols. The three runs execute in
parallel; candidates execute sequentially. Reconstruction, verification, and
review run normally, but Gate runs cannot trigger further evolution.

Promotion requires target `structure_f1` delta ≥ +0.05, both regression deltas
≥ −0.02, and successful completion of all three runs. `edge_f1` is retained in
workflow scores but does not decide promotion. A failed execution is rejected,
even if its partial workflow scores well. Evaluations retain candidate and
baseline run IDs, scores, deltas, statuses, decision, and reason. Repeating an
evaluated Gate returns its stored result without launching more runs.

`gate_result`, its evaluation, the `bulk_write` that supersedes the old active
version and activates the candidate, and `harness_promoted` share one MongoDB
transaction. The scalar status of the promoted version is `active`; promotion
history is in its evaluation and event. Rejected versions keep `eval.reason`.
The triggering run carries all harness events and ends with `run_finished`.

Run the API with one Uvicorn worker. An in-process lock serializes evolution
and Gates; a partial unique MongoDB index permits only one pending candidate.
Do not run a CLI Gate and an API Gate on the same pending candidate at once.

```sh
# Existing selected run: create and evaluate its pending candidates in order.
backend/.venv/bin/python -m backend.evolver eb714aed407a42439a02faf9a9151f1d
backend/.venv/bin/python -m backend.verify eb714aed407a42439a02faf9a9151f1d --export fixtures/run_example.jsonl
backend/.venv/bin/python backend/check_m7.py eb714aed407a42439a02faf9a9151f1d
```

`POST /harness/evolve` with `{run_id}` returns `{version}` and starts that
candidate's Gate in the background. `POST /harness/gate/{version}` waits for
and returns the Gate result. Normal inline evolution processes the triggering
run's eligible proposals sequentially. `check_m7.py --progress` reads candidate
and run progress without creating new runs. The final check reports loop
integrity separately from the original promotion-and-transfer done-when test;
a legitimate rejection must not be reported as a successful promotion.

## M10 benchmark archive and normalization

From the repository root:

```sh
backend/.venv/bin/python -m backend.import_benchmark ../libstruct-bench/runs
backend/.venv/bin/python -m backend.import_benchmark --normalize-only
backend/.venv/bin/python -m backend.check_m10
```

The importer reads only `../libstruct-bench/runs/` and selects the original 20
native Codex baselines named in `libgen/codex/libgen-gpt-5-6-sol/result.json`.
Later protocol waves and other systems are excluded, including on re-import.
Each selected `result.json` becomes one `benchmark_records` document.
`raw` is the exact UTF-8 file text. `attachments`
archives the final Task 3 prediction, latest saved verifier rescore, error
analysis, and a GT snapshot found under `runs/`. No task/source path inside a
record is followed outside that directory. Raw archival files are private;
public run APIs expose only symbolic graphs, saved scores, and provenance.

Each trial has a stable run keyed on executor, model, harness version, and
protocol. The harness label uses the saved job path; copies of a trial in
review workspaces retain that identity. For duplicate attempts, normalization
selects the latest completed attempt (including scored model failures), with
failed infrastructure attempts used only when no completed attempt exists.
Ties prefer the most complete archived copy, then its source path. Scores never
influence selection. The first-wave job summary is archived as an attachment
so the original selection remains auditable.

`--normalize-only` uses MongoDB's `benchmark_records` alone, including for
protocol and GT setup. Existing protocol names, families, roles, and GT are
preserved. Missing families default to `unclassified`. Reimport updates the same
run and appends revision/commit events, saved scores, and `run_finished`;
previous events and findings remain in the log. An unchanged import writes no
new events. Imported scores never become Gate baselines.

Saved metric names and units are preserved, including legacy library metrics.
An unscored attempt emits `benchmark_scored` with `metrics: {}`. Missing Task 3
artifacts leave an empty graph. All native strands, segment order, pairings and
discontinuities are preserved symbolically in `benchmark_structure`; nucleotide
sequences stay out of workflows. A discard-only native transition cannot be a
§2.1 carried-product edge: its native representation is retained, and an import
finding explains the display limitation. Saved benchmark observations produce
verifier checks; the importer does not invent an agent trace or Evolver signals.

`GET /protocols` returns run sources in the §2.6 shape:
`{run_id, source, executor, model, harness_version, benchmark_score?}`.
`POST /import` requires a local caller and a configured `X-Review-Token`, and
returns `{records, runs}` with counts of new or changed records/runs. The CLI
remains available for local setup. Harbor trajectory mapping is described below.

## M11 authenticated reviews

Set `REVIEW_TOKENS` to comma-separated `token:name:role` entries. Roles are
`curator` or legacy `author`. Curators use this configuration; authors need a
protocol-scoped M15 invite. Requests cannot supply a reviewer. All write routes
require `X-Review-Token`; imports and harness writes require a curator.
Read routes are public except `GET /invites`. `CORS_ORIGINS` defaults
to `http://localhost:3000` and accepts a comma-separated list.

`EXECUTOR=none` exposes saved runs and authenticated reviews with no model or
CLI dependency. `GET /config` reports `{executor, live_runs, stream_mode}`;
`POST /runs` returns 501 when live reconstruction is disabled. Otherwise the
optional request `executor` is honored; unsupported executors return 501.

`POST /runs/{id}/reviews` accepts the §2.5 Review fields except `_id`,
`created_at`, and `reviewer`. Include `run_id`, the current `workflow_revision`,
`target_id`, and the exact current target as `before`.

- `modify`: supply the corrected `after` and a confirmed `error_type` from the
  six §2.4 categories. State edits use `origin: human`, clear that state's stale
  flag, and mark downstream states stale. For an imported state, update its
  complete `benchmark_structure` when changing its preview, or explicitly omit
  that field; an unchanged native structure cannot silently override the edit.
- `reject`: `after: null`, with confirmed `error_type`. Rejecting a state also
  removes or revises incident transitions so no dangling endpoints remain.
- `accept` / `unresolved`: `after` and `error_type` are null or omitted. These
  decisions update review status without changing the workflow revision.

A graph-changing review bumps the revision once. All graph events, GT rescoring
through `verifier.py`, the append-only review, human signal, memory candidate,
and completion event commit in one transaction. Stale revisions or changed
`before` values return 409 without writes. Saved benchmark scores are preserved.
The response is `{review_id, workflow_revision, derived}`, where `derived`
contains the created `signal_id` and/or `memory_candidate_id`.

Memory candidates start unverified. Accepting the same symbolic entity in a
second protocol verifies matching candidates; an ordinary curator review does
not bypass that requirement. `GET /memory?operation=&type=` returns verified
entries only. GT correction and training export remain flags in M11:
`reviews.gt_candidate`, `runs.gt_candidate`, and `runs.verified_through_revision`.
A GT candidate flag compares the edited target with GT; it does not rewrite GT.
Unresolved or unreviewed failed-check targets keep the verified revision unset.

`GET /runs/{id}/reviews` returns review history. `/queue` counts remaining failed
checks without a current review and latest unresolved decisions, sorted by need.
Checks lacking an attributable target remain outstanding. `/benchmark` accepts
`group_by=version|executor|protocol`, returning rows with `group`, `group_by`,
`runs`, `benchmark_score`, `gt_score`, and `gt_scored_runs`. Different saved scorer
versions use separate rows. Each metric averages only runs containing that
metric; missing scores never become zero or proofread structure F1.

With port 8000 free, run `backend/.venv/bin/python -m backend.check_m11` from the
repository root. It starts its own API with `EXECUTOR=none` and an ephemeral
review token, submits reviews with curl, verifies database fan-out and read
routes, and removes its temporary runs/chunks/reviews/signals/entities. The
selected 20 benchmark runs and their event logs remain unchanged.

## D1 Google Cloud Run backend

Build from the repository root with `backend/` as the build context:

```sh
docker build -t proofread-backend:cloudrun backend
```

Export `MONGODB_URI` and `REVIEW_TOKENS` into the shell environment from your
secret store, then run:

```sh
docker run --rm --name proofread-backend -p 127.0.0.1:8001:8080 \
  --env MONGODB_URI --env REVIEW_TOKENS \
  --env EXECUTOR=none --env PORT=8080 \
  --env CORS_ORIGINS=http://localhost:3000,https://acolytics.com \
  proofread-backend:cloudrun
```

In another terminal:

```sh
curl --fail http://127.0.0.1:8001/config
curl --fail http://127.0.0.1:8001/protocols
```

`/config` reports `executor: "none"`, `live_runs: false`, and
`stream_mode: "stream"`. `/protocols` reads the existing Atlas database.
The container starts Uvicorn on `0.0.0.0:$PORT` as an unprivileged user, with
port 8000 as the local default. Cloud Run supplies `PORT`. The container does
not initialize or seed the database. Its build context excludes `.env`, local
environments, node modules, and seed data. Only Python source, the base prompt,
and requirements are copied into the image.

`CORS_ORIGINS` is a comma-separated list of exact browser origins; whitespace
around entries is stripped. Use scheme and host, with a port when needed;
the `/proofread` path is not part of an origin.

For Cloud Run, install the Google Cloud CLI, sign in, and select the project:

```sh
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
cp backend/.env.cloudrun.example backend/.env.cloudrun
chmod 600 backend/.env.cloudrun
```

Skip the copy if the private file already exists. Fill in `MONGODB_URI` and
`REVIEW_TOKENS`, keep `EXECUTOR=none`, and set the comma-separated
`CORS_ORIGINS` for the web deployment. This file is ignored by Git and excluded
from both the Cloud Build upload and the Docker image. The script passes it
as runtime configuration using `--env-vars-file`, without sourcing it as shell
code or putting secret values in command-line arguments. A private temporary
copy ending in `.env` makes gcloud recognize dotenv syntax; it is outside the
source upload and is removed on exit.

With billing and Cloud Run source-deployment permissions configured, run from
any directory:

```sh
/path/to/proofread/backend/deploy.sh
```

The script runs `gcloud run deploy proofread-api --source backend --region
us-east4 --allow-unauthenticated --timeout 3600 --min-instances 1`, using the
selected gcloud project and the private env file. It then checks `/config`
and `/protocols` and prints the `https://…run.app` URL on its final line. Cloud
Run permits public reads; application writes still require `X-Review-Token`.
Atlas must allow the deployed service's egress.

References: [deploying from source](https://docs.cloud.google.com/run/docs/deploying-source-code),
[deploy flags and env files](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy),
and [the container port contract](https://docs.cloud.google.com/run/docs/container-contract).

Local validation on 2026-09-26: the image served `/config` and all 20 imported
protocols against Atlas with `PORT=8080` and `EXECUTOR=none`. Both configured
CORS origins passed review preflights. The installed gcloud parser preserved
all five env values, and its upload manifest contained only the 32 build/source
files. The temporary container was removed without database writes.

Cloud Run deployment passed on 2026-09-26 in project **acolite** (project ID
`gen-lang-client-0325887617`), region `us-east4`. `backend/deploy.sh` completed
and printed `https://proofread-api-7jj27cadja-uk.a.run.app` after both public
endpoint checks passed. Revision `proofread-api-00001-dqg` serves the deployment
with a 3600-second request timeout and one minimum instance.

- [Public config](https://proofread-api-7jj27cadja-uk.a.run.app/config):
  `executor: "none"`, `live_runs: false`, `stream_mode: "stream"`.
- [Public protocols](https://proofread-api-7jj27cadja-uk.a.run.app/protocols):
  20 protocols with 20 Codex benchmark sources from Atlas.

## M13 cDNA skills package

Symbolic molecule models and skills live in `../cdna/cdna/`. Proofread installs
`cdna-engine @ git+https://github.com/seqmachines/cdna@v0.2.1` through
`requirements.txt`. The tag resolves to `6c3af694c296952d517cef77c74199a05e2f323c`.
Docker includes Git and CA certificates to install directly from GitHub; no
vendored wheel or sibling checkout is needed. Install from the repository root:

```sh
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

After releasing a new cDNA version, update the Git tag in the pinned requirement.

`cdna.molecule` owns the unchanged MoleculeState/Transition schema;
`cdna.skills` owns `reverse_transcribe` and `template_switch`. The standalone
`cdna-mcp` command, or `python -m cdna.mcp_server`, exposes both named tools
without proofread, MongoDB, ground truth, or model credentials.

Proofread mounts cDNA's schemas through `harness.render()`. Its adapter in
`AgentTools` requires the exact committed substrate, checks harness access,
assigns `skill_call_id`, and emits `skill_called`. Products remain uncommitted
until the agent calls `commit_state`. The existing `run_skill` entry point
uses the same installed implementation. Review and benchmark request models
remain in `tool_models.py`; no duplicate molecular implementation is retained.

Run the M13 done-when check with Claude Code 2.1.221 or later and a working
Claude login:

```sh
backend/.venv/bin/python -m backend.check_m13
```

It creates one synthetic run, exercises the real proofread MCP server, checks
skill provenance and harness restrictions, then removes that run and its
chunk. It also runs `claude -p` in an empty directory with only cDNA's MCP
server, no built-in tools, and no database/run env variables. Success requires
an actual `template_switch` tool call and its returned state. CLI versions
before 2.1.221 can start the first turn before MCP tools are ready; prose that
claims a call succeeded does not pass this check.

## M14 Harbor trajectories

Attach the saved trajectories to the original 20 Codex baselines:

```sh
backend/.venv/bin/python -m backend.import_benchmark ../libstruct-bench/runs --source harbor
backend/.venv/bin/python -m backend.import_benchmark --normalize-only
```

The first command reads only the selected `runs/` artifacts. Agent messages
become `step_started`, recognized file reads with recorded text become
`evidence_searched`, and explicitly stated assumptions become `assumption`.
Recorded commands are never executed. Text excerpts omit nucleotide sequences
and credentials; binary/image output is omitted. Excerpts are capped at 12,000
characters per recorded read, with 400-character trace snippets. Page 0 means
the output did not identify a page. Evidence chips resolve through `/chunks`.

`benchmark_records.trajectory` stores the mapped events, chunks, source path,
and source digest. This avoids storing large inline images and lets
`--normalize-only` work without the checkout. A later record-only import
preserves this trajectory.

Per approved §2.2/§2.7, normalization rebuilds an imported run's entire stream
and workflow in one transaction through `emit()`: start, trace, final graph,
checks and benchmark scores, retained review/edit/scoring history, finish.
The old stream is archived in `benchmark_records.normalization.original_events`.
Run IDs, graph IDs, reviews, workflow revisions and both score sets are
preserved; a rebuild that would change the current workflow is rejected.
`runs.normalization_version` records `m14.1`. Identical normalization is a no-op.
Both importer and event writer refuse re-normalization of live runs.

Reload an already-open run after normalization to replay from `since=0`.
The old sequence cursor refers to the earlier stream.

The done-when check imports the real panel, verifies unchanged workflows and
review records, checks idempotence and live-run exclusion, then replays the
SMART-seq paper baseline through the public API, SSE and actual web reducer:

```sh
backend/.venv/bin/python -m backend.check_m14 \
  --base https://proofread-api-7jj27cadja-uk.a.run.app
```

See `M14_RESULTS.md` for the recorded result.

## M15 author invites and reviewer fixes

A curator sends `POST /invites` with `{protocol_id, name}` and
`X-Review-Token`. The response includes `invite_id`, `protocol_id`, `name`,
`role: "author"`, `created_at`, and a one-time `token`. Give that token to the
reviewer for the existing `X-Review-Token` flow. Only its SHA-256 digest is
stored. Curators can `GET /invites` for metadata; tokens and digests are omitted.

The author may review any run belonging to the invited protocol. Writes to
another protocol return 403. Import, harness, and invite administration remain
curator-only. `POST /runs` also authenticates and checks the requested protocol.
Legacy env author tokens lack a protocol scope and cannot write.
`POST /runs/{id}/messages` returns 501 with `EXECUTOR=none`, without model calls
or event writes; typed reviews remain available.

`GET /runs/{id}/gt-diff` now returns `matched_states` and
`matched_transitions`: `{predicted, truth, similarity}` pairs aligned by segment
structure, operations, and mapped endpoints. IDs serve as references, not
matching criteria. `missing_states` / `extra_states` and
`missing_transitions` / `extra_transitions` contain the unmatched objects.
`missing_edges` / `extra_edges` retain typed-edge details. State objects use
§2.1; GT transitions retain native symbolic fields and endpoint arrays, including
multiple substrates/products. Similarity is in [0, 1]; no sequence term is used.

Public workflow, event, and SSE responses format verifier names as words and
remove audit coordinates, internal IDs, and paths from messages. Structured
navigation fields remain. Stored events and machine check keys are preserved.

Seed the selected panel's frozen source documents separately from import:

```sh
backend/.venv/bin/python -m backend.seed \
  --benchmark-chunks ../libstruct-bench/benchmarks/libgen/tasks
```

This setup-only exception is recorded in SPEC §0. The seeder verifies canonical
manifest hashes and each file's SHA-256 at the pinned Hugging Face revision.
It reads task metadata without executing task code. Source files are cached
under ignored `backend/seed/frozen-*/source/` directories. PDF pages, Word text
blocks, and bounded spreadsheet sections receive stable chunk IDs; nucleotide
sequences are omitted. Existing trajectory evidence is preserved. Seeding does
not invent citations for imported graph items that have no evidence links.
Legacy `.doc` extraction uses `antiword`, or `textutil` on macOS.

Run the done-when check against the configured Atlas database:

```sh
backend/.venv/bin/python -m backend.check_m15
```

It creates two temporary runs and one invite, proves a scoped author review
succeeds and a cross-protocol review returns 403, checks disabled chat and
curator restrictions, canonical alignment, public messages, and chunk resolution.
It removes only its temporary records and verifies all saved runs are unchanged.
See `M15_RESULTS.md` for deployment and verification results.
