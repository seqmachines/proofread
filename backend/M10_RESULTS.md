# M10 — benchmark import into the new cluster

Date: 2026-09-26. Source: local `../libstruct-bench/runs/` only.
The earlier 20-Codex-only importer has been replaced.

## Implementation

- Archive every `result.json` verbatim in `benchmark_records`, with executor,
  model, saved job/harness identity, protocol, scorer version (or `unknown`),
  Harbor trial ID, source path, content hash, and import time.
- Archive the prediction, latest verifier rescore/error analysis, and available
  GT snapshot alongside the raw record. No reads from benchmark schemas,
  analysis inventories, task directories, or external paths inside records.
- Normalize solely from MongoDB. Select the latest completed attempt per
  `(executor, model, harness_version, protocol_id)`, preserving a failed attempt
  when that is all the system has. Copies and retry records remain archived.
- Stable run IDs plus a unique index prevent duplicate system × protocol runs.
  Changed imports append commits/revisions, `benchmark_scored`, and
  `run_finished`; they never remove earlier events. Unchanged imports are no-ops.
- Seed missing protocol metadata and GT with setup writes; preserve existing
  protocol roles/families and GT. No executor access to ground truth.
- `GET /protocols.sources` uses exactly the §2.6 run-source objects, with saved
  scores under their original names. Imported metrics are never Gate baselines.
- Approved §2.1 score extension supports arbitrary saved numeric metric names
  and units, and `{}` for unscored attempts. A missing Task 3 artifact leaves an
  empty graph. All available native strands remain in symbolic structures.

## Verification

```sh
backend/.venv/bin/python -m backend.db
backend/.venv/bin/python -m backend.check_m10
```

The done-when check archives every file, disables benchmark file reads while
normalizing from MongoDB, verifies every source object via HTTP, and replays
every imported run over SSE. It checks contiguous sequence numbers, exact saved
scores, symbolic graphs, and equality between event folds and workflow snapshots.
It also imports a genuine older saved attempt first to exercise an in-place
update while preserving the earlier log, then verifies unchanged re-imports
produce no events.

## Data coverage and limitations

The tree contains 951 result files: 820 trial records, 129 job summaries or
bundle manifests, and 2 malformed JSON files. Aggregate files have no individual
protocol, so they remain archival records. Malformed files retain their raw text
and use `unknown` metadata where it cannot be recovered.

The four §2.1 metrics are absent from 80 older library-structure trials and 56
unscored library-generation trials. Saved legacy metric names/units and missing
scores are represented explicitly; no substitute scores are calculated.

Discard-only native operations have no carried product, so §2.1 cannot represent
them as a carried-product edge. The converter preserves their native disposition
in GT scoring data and archival predictions and emits a visible import finding
for affected predictions. It does not invent a carried product. Two corrupted
predictions have redacted pairing keys and cannot be normalized; their empty
graphs and import findings preserve that limitation.

## Passed result

`python -m backend.check_m10` printed **M10 DONE-WHEN PASSED** on the new
`proofread` database:

| Check | Result |
| --- | ---: |
| Archived result files | 951 |
| Protocols, all with available GT | 73 |
| Distinct executor/model/harness systems | 117 |
| System × protocol runs | 696 |
| Events checked through HTTP and SSE | 31,149 |
| Symbolic states / transitions | 4,887 / 4,518 |
| Selected attempts without saved scores | 63 |
| Failed selected attempts | 88 |

The genuine older-to-latest update exercised run
`97b5e574ab285b3eb8c2e5649cf1703c`; earlier events were unchanged and the final
snapshot matched replay. Re-archiving and normalization both returned zero
changes on repetition. All 696 imported source entries match the required
§2.6 shape. The executor's transitive local import graph still excludes
`seed`, `setup_db`, `import_benchmark`, and `verifier`.

## User-requested restriction to the original 20 Codex baselines

On 2026-09-26, the user narrowed the displayed data to the original first-wave
Codex panel. `libgen/codex/libgen-gpt-5-6-sol/result.json` names exactly those
20 trials; the panel matches the earlier paper-baseline selection. The importer
now selects only these trials, including on repeated full-root import.

`python -m backend.retain_codex_baselines` validated every retained run and saved
score, then performed one transactional cleanup in proofread:

- Kept 20 runs, 20 workflows, 20 archival result records, 20 protocols, and 989 events.
- Removed 678 other runs/workflows (including the two live Smart-seq2 tests),
  30,365 events, 931 archival records, 53 unused protocols/GT records, 191 source
  chunks for removed protocols, and 3 signals. There were no reviews or memory
  entities to remove.
- Preserved all local benchmark and backend seed files, the retained run IDs,
  their event logs and saved scores, and harness configuration.

The earlier whole-tree coverage table above records the completed broad-import
check; it no longer describes the current selected database contents.

The restricted `python -m backend.check_m10` passed: 20 protocols, one system,
20 runs, 989 replayed events, 174 states, and 164 transitions; no failed or
unscored baseline. Re-import and normalization both made zero changes.
