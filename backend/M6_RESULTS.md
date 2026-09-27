# M6 results — Smart-seq2

2026-09-26. M6's done-when check passed for
**`eb714aed407a42439a02faf9a9151f1d`**. The run is `done`; its five states and four
transitions are unchanged. The complete stored `v0` document matches the
pre-review snapshot: template switching remains available and the only enabled
guardrail is `evidence_required`.

## Two separate proposals

| Signal | Classification | Proposed change |
| --- | --- | --- |
| `sig_b51be704839c45ad` | `molecular_state_or_assembly_error×template_switching` | `tool_access.template_switch`: `available` → `mandatory` |
| `sig_88fa3ff1d36943b5` | `strand_or_orientation_error×pcr` | Add `bottom_strand_3to5`, preserving `evidence_required` |

Both have `harness_relevance: high`, source evidence, and non-null validated
patches. Both remain `processed: false` and `systematic: false`. The orientation
signal targets `cdna_amp` and has root cause `bottom_strand_listed_5to3`.
The missing-intermediate signal targets its RT substrate, `S_6f364bc90a39`.

A third, low-relevance ISPCR naming finding remains without a patch:
`sig_16968d8244284b6e`. It notes that existing handles may already represent
the named primer's binding sites, so a naming mismatch alone does not justify
another harness change.

M7 candidate creation, execution, and promotion have not run. The two high
signals are ready for separate candidate evaluations under the current SPEC.
A change that only reverses the bottom listing cannot improve the new
`structure_f1`; the Gate's existing improvement threshold remains unchanged.

## Orientation scoring and enforcement

The scorer projects both possible bottom listing directions and uses the maximum
state similarity in both alignment and final scoring. It does not change run
states. The three existing Gate baselines were reevaluated:

| Run | structure_f1 | edge_f1 |
| --- | ---: | ---: |
| `468e160ab2914beda980a1a9fad8a6a9` | 0.764583 | 0.666667 |
| `ccb047a9b74f4abc953f2df43f86b74a` | 0.687222 | 0.400000 |
| `eb714aed407a42439a02faf9a9151f1d` | 0.690179 | 0.461538 |

The selected run previously scored 0.682143. Reversing its bottom arrays in a
local counterfactual now leaves both scores identical. Native self-comparisons
remain 1.0. GT-free orientation checks continue to fail on the committed row.

The guardrail is implemented but only applies when the harness enables it.
With v0 settings, `commit_state` accepts the original row. With the additional
guardrail, the same call emits `guardrail_blocked` and returns:

> bottom_strand_3to5: bottom strand is listed 5′→3′; list it 3′→5′, aligned under the top strand, before committing.

The aligned local copy is accepted. No live workflow was repaired to run this
check. Detection requires two distinct, uniquely matched anchors; ambiguous
rows cannot establish a listing direction from symbolic data alone.

## Review validation and event history

Each invocation uses one tool-free Codex turn with `CODEX_MODEL` from the env.
The first development review produced the requested proposals but contradicted
the observed orientation in one explanatory sentence and labeled its operation
`other`. The reviewer now receives the exact deterministic anchor orders and
producing operation and must preserve that diagnosis. A second review corrected
the pending signals through new events; earlier events were retained.

The current orientation finding states:

> cdna_amp: bottom shared-segment order is oligo_dt → insert → tso; §2.1 requires tso → insert → oligo_dt in the displayed 3′→5′ row.

`fixtures/run_example.jsonl` now contains all **63** stored events. The updated
score is at seq 53; the current high-relevance findings are at seq 61 and 62;
seq 63 is `run_finished`. Consumers should use the latest finding for a repeated
signal ID when presenting the current diagnosis, while retaining earlier trace
events for replay.

Validation confirmed:

- The real M6 check passed with persisted high-relevance signals and proposals.
- Event sequence numbers are contiguous and each latest finding matches its
  signal document; signal/event writes share a MongoDB transaction.
- The exact v0 policy and all committed states/transitions are unchanged.
- Agent and reviewer import traversal does not reach verifier, gate, or setup.
- The normal runner orders reconstruction → GT-free verification → review →
  `run_finished`. The live API was restarted with this completion hook.
- Invalid patch types and rules without operation scope are rejected.

No M7 candidates or promotion events were fabricated.
