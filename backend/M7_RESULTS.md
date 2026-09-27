# M7 — two sequential candidate evaluations

2026-09-26. The Evolver and Gate completed both requested candidates. **Both
were rejected. `v0` remains active.** The original M7 done-when criterion
(promote v1, then demonstrate the fix on Smart-seq3) has **not** passed.
There was no promoted version to use for that follow-up, so it was not run.

The triggering run is **`eb714aed407a42439a02faf9a9151f1d`**. Its full event log
is re-exported to `fixtures/run_example.jsonl`: **84 events**, including both
candidate creations, both Gate results, and a final `run_finished`. No
promotion event was fabricated. Its five states and four transitions remain
unchanged, with `structure_f1 = 0.690179` and `edge_f1 = 0.461538`.

## Baselines started before code changes

All three requested v0 runs started in the background before M7 implementation.
Each finished and was scored through the isolated Gate entry point.

| Protocol | Run ID | structure_f1 | edge_f1 |
| --- | --- | ---: | ---: |
| sci-RNA-seq | `a0fc0f6423b54a96ae4a7143c0113ab2` | 0.674697 | 0.777778 |
| Plate scATAC-seq | `d8bdf4bcd083492ca09036e114b823d1` | 0.399206 | 0.333333 |
| Smart-seq3xpress | `119b526a241a4f939649cc8f0f5fc883` | 0.511209 | 0.869565 |

The Smart-seq3xpress baseline is stored for later transfer evaluation. It was
not a regression protocol. Both Gates compare to the same fixed v0 baselines,
as specified in §3, with the exact triggering run as the Smart-seq2 baseline.

## Gate results

All numbers below are `structure_f1`. Thresholds stayed at target delta ≥ +0.05
and minimum regression delta ≥ −0.02. Failed executions also block promotion.
Each candidate used one fresh run per protocol; no result was replaced by a
more favorable repeat.

| Candidate | Protocol | v0 before | Candidate after | Delta |
| --- | --- | ---: | ---: | ---: |
| v1 | Smart-seq2 (target) | 0.690179 | 0.732639 | +0.042460 |
| v1 | Plate scATAC-seq | 0.399206 | 0.474107 | +0.074901 |
| v1 | sci-RNA-seq | 0.674697 | 0.603904 | −0.070793 |
| v2 | Smart-seq2 (target) | 0.690179 | 0.613750 | −0.076429 |
| v2 | Plate scATAC-seq | 0.399206 | 0.353155 | −0.046051 |
| v2 | sci-RNA-seq | 0.674697 | 0.667950 | −0.006747 |

### v1 — rejected

Parent `v0`. The Evolver produced exactly two patches: make `template_switch`
mandatory and add `provenance_required`. Source signal:
`sig_b51be704839c45ad`.

Target improvement was below +0.05, and sci-RNA-seq exceeded the allowed
regression. Independently, Smart-seq2 reconstruction completed but its reviewer
response failed validation: `Reviewer omitted the distinct bottom-strand
orientation proposal`. The run stayed `failed`; its real persisted graph was
scored, and that failure is retained in `eval.reason`. Even without this review
failure, its measured target and regression deltas would reject v1.

| Protocol | Candidate run |
| --- | --- |
| Smart-seq2 | `5c4806bbc4c143f1b552871b9a4b4729` |
| Plate scATAC-seq | `47c2e41d8067490594a58bacce018a0c` |
| sci-RNA-seq | `3a1a1c1d63314e489d139bb1d8037981` |

### v2 — rejected

Created after v1's rejection, with parent **`v0`**. Its only patch adds
`bottom_strand_3to5`; template switching remains available. Source signal:
`sig_88fa3ff1d36943b5`.

All three runs completed. The target score decreased, and plate scATAC-seq
exceeded the allowed regression. All three latest strand-consistency checks
passed, but the Gate measures molecular structure. Correct listing direction
alone earns no extra score under the orientation-tolerant metric; these fresh
runs also changed molecule content and topology.

| Protocol | Candidate run |
| --- | --- |
| Smart-seq2 | `9665643dabdf439aa5021fe5c6f6ea89` |
| Plate scATAC-seq | `c60a33e096a444a682d676be0877ec1d` |
| sci-RNA-seq | `b2a78862140641deba6acca9608ae2e0` |

## Implementation and validation

- One Codex call per candidate receives its signal and active harness without
  GT or scores. Candidate patches are validated again at write time.
- Unknown types/paths, workflow-wide rules, missing operation scope, and CLI
  history patches are rejected. Invalid candidate writes roll back the event,
  version, source-signal consumption, and sequence increment together.
- Candidate creation, signal consumption, evaluations, and harness statuses
  change through `emit()`. The promotion path uses one transactional
  `bulk_write` and promotion event; neither real candidate qualified to exercise
  that path in this evaluation.
- Each Gate runs its three protocols in parallel. Candidates remain sequential;
  Gate runs cannot recursively evolve their own review findings.
- Both high-relevance source signals are processed. Exactly one harness is
  active. v0 settings and the triggering workflow are unchanged.
- The fixture matches MongoDB events exactly, with contiguous sequence numbers
  and both Gate decisions under the triggering run ID.
- Transitive local imports from `agent.py` cannot reach the Gate, verifier,
  Evolver, or setup code. Runtime GT reads remain in `verifier.py`.
- `check_m7.py` checks real scores, decisions, parent selection, snapshots,
  event ordering, fixture equality, and forbidden-patch rollback. It reports
  loop integrity separately from the unmet original promotion done-when test.
- The restarted API returns both stored Gate decisions without new model runs
  or events. SSE at `speed=8` replayed seq 64–84 in order, including both Gate
  results and the final terminal event. The live stream stayed open afterward.

No §2 contract changes were made for M7. No v0 prompt or molecular skill was
changed to improve these results.
