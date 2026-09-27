# M4 results — Smart-seq2

This records the original M4 check. M6 subsequently made structural scoring
tolerant of bottom-row listing direction and appended review events. See
[M6_RESULTS.md](M6_RESULTS.md) for current scores and fixture contents.

2026-09-26. All three original M3 runs were scored retroactively through
`python -m backend.verify <run_id>`. The API done-when check passed on all three:
five persisted checks, at least one failure, readable structure/edge scores,
matching snapshot/event projections, contiguous sequence numbers, and a final
`run_finished` event. All three are marked `baseline: true` in Atlas.

| Run | Run ID | structure_f1 | edge_f1 | Failed checks | Events |
| --- | --- | ---: | ---: | --- | ---: |
| Initial | `468e160ab2914beda980a1a9fad8a6a9` | 0.764583 | 0.666667 | graph_connected | 78 |
| Repeat 1 | `ccb047a9b74f4abc953f2df43f86b74a` | 0.687222 | 0.400000 | oligos_represented | 56 |
| Repeat 2 | `eb714aed407a42439a02faf9a9151f1d` | 0.682143 | 0.461538 | oligos_represented, strand_consistency | 47 |

## Selected fixture

`fixtures/run_example.jsonl` exports repeat 2, run
**`eb714aed407a42439a02faf9a9151f1d`**. It has five states and four transitions.
The RT skill produces `S_6f364bc90a39`, then `pcr_cdna` jumps directly to
`cdna_amp`. No template-switching transition or separate switched cDNA state
exists, although the PCR product introduces a TSO-derived handle.

The GT-free `strand_consistency` failure identifies that unsupported introduction
and the reversed bottom-strand order in `cdna_amp`. `oligos_represented` reports
that ISPCR is named in evidence but has no identifiable corresponding segment.
The GT diff independently reports missing states `st_hybrid_ctail` and
`st_full_length_cdna`, plus five missing typed edges and two extra typed edges.
The missing full-length, template-switched state also appears in repeat 1's
GT diff; the exact strand-order failure occurs only in repeat 2.

Events 1–40 are the original M3 run, including its original completion at 40.
Events 41–45 are verifier checks, 46 is `gt_scored`, and 47 is the new completion.
The append-only history was preserved. No M6 findings or M7 harness events were
added. The API is serving the live snapshots and GT diff on port 8000.

## Metric definition and limits

Source definitions: LibStructBench (Poon et al., 2026), local
`../libstruct-bench/schemas/groundtruth/library_generation_workflow.schema.json`
and `../libstruct-bench/src/libstruct_bench/libgen/scoring.py`.
The implementation is local to proofread; benchmark code is not imported and
`improvement/` was not read.

- `structure_f1` uses architecture, ordered segment structure, and pairing/gaps.
  The source's weights 0.15 / 0.20 / 0.15 become 0.30 / 0.40 / 0.30 after dropping
  reference sequence. Architecture compares strand architecture, strand count,
  and strand molecule types. Ordered segments compare symbolic role aliases
  and structural roles at each position, then strand chemistry and orientation.
  No sequence term is used anywhere, including segment or oligo matching.
- Strand collections and states use maximum-weight one-to-one assignments.
  State alignment includes boundary and incoming/outgoing operation context;
  state/transition assignment uses the benchmark's 0.25 floor. Soft F1 is
  `2 × summed matched similarity / (predicted count + supported truth count)`.
  Supported truth is explicit/derivable; matches to neutral truth are excluded
  from the prediction count. Pairing compares covered strand regions and gaps;
  fully covered duplex regions are independent of region partitioning.
- `edge_f1` matches typed substrate, carried-product, and discarded-product
  edges after state and transition alignment. Transition alignment considers
  operation, mapped endpoints, dispositions, and symbolic oligo aliases.
  Supported and neutral edge sets are handled separately.
- The native GT metadata retains structural roles, pairing, discontinuities,
  support, and dispositions. The §2.1 prediction format exposes only two aligned
  segment rows, so its chemistry and architecture are inferred from labels and
  strand presence; pairings are inferred from symbolic correspondence.
  Missing fine-grained metadata and compound segment names limit precision.
  These scores are **not comparable to the paper's sequence-based state F1**.

## Validation

- Native graphs score 1.0 against themselves for both metrics; reversing an
  ordered strand lowers structural similarity, and moving discarded products
  to carried products lowers edge F1.
- The seeded scorer metadata contains no sequence or sequence-architecture
  fields. Agent import traversal reaches only agent, db, engine, evidence,
  embeddings, molecules, and skills.
- A local completion-hook check confirms five GT-free verifier events precede
  `run_finished`; attempting a GT read in that path would fail the check.
- The real API check (`backend/check_m4.py`) passed for all three runs.
  The fixture is the exact ordered event log of the selected run.

At the M4 checkpoint the M6 reviewer hook was unset. The Gate contains only the M4 evaluation
entry point; candidate execution and promotion remain M7 work.
