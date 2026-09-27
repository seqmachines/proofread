# v3 — conditional mandatory skills

Four measurements finished at **14:47:35 EDT on 2026-09-26**. The formal Gate
decision is pending the user's definition of the σ rule, which is absent from
the current SPEC and backend. No σ threshold or baseline aggregation has been
assumed. The original v1/v2 decisions remain unchanged and v0 remains active.

## Changes

- `harness.render()` makes every mandatory skill conditional on the protocol
  performing its operation, and explicitly forbids adding unsupported operations.
- The shared base prompt includes that prohibition for all versions and names
  the benchmark category `unsupported_completion`.
- v3's parent is v0. Its only patch is `tool_access.template_switch`:
  `available` → `mandatory`. Its only guardrail remains `evidence_required`.
- Human signal `sig_v3_template_switch_only` records the explicit retry request
  under demo run `eb714aed407a42439a02faf9a9151f1d`. The Evolver generated and
  validated exactly that patch. No RT skill implementation was changed.
- The proposed §2 GT-diff application extension remains on hold. No route or
  nullable state/transition event from that proposal was implemented.
- Overlapping ordinary runs now retain their signals and defer automatic
  evolution while another run owns the candidate slot; that wait no longer
  changes an otherwise finished reconstruction to `failed`.

The two target runs and the two regression runs were independent and executed
in parallel. Gate completion hooks were disabled on these runs to avoid
recursive evolution. Every recorded score is retained; no repeat was substituted.

## Measurements

| Protocol | Run | structure_f1 | Run status |
| --- | --- | ---: | --- |
| Smart-seq2 target 1 | `0b6cffb706094194862ab768eaf65f48` | 0.732083 | failed in review |
| Smart-seq2 target 2 | `286f99e8f518493ea663c406179f63bd` | 0.640575 | failed in review |
| Plate scATAC-seq | `a38e68fc8a2b4ce9bf96b5ea8efe76c6` | 0.400843 | done |
| sci-RNA-seq | `d4bd5e99d06041669439690fd8a565f7` | 0.644879 | done |

The target mean is **0.686329**, a change of **−0.003850** from the previous
selected target baseline (0.690179). The plate regression change is +0.001637;
the sci-RNA-seq change is −0.029818 against the same stored baselines used for
v1/v2. These are measurements, not an assumed σ-rule decision.

The three original Smart-seq2 v0 scores are 0.764583, 0.687222, and 0.690179.
Their mean is 0.7139946667; sample standard deviation is 0.0438357225
(population standard deviation 0.0357917175). Which baseline and σ estimator
the requested rule should use is awaiting clarification.

## Observed behavior

Both regression workflows contain no template-switching state or transition.
sci-RNA-seq uses the RT skill and proceeds to second-strand synthesis,
tagmentation, and PCR. Plate scATAC-seq uses tagmentation and PCR. This addresses
the unsupported-operation behavior seen in v1.

Both Smart-seq2 runs use successful template-switching skill calls. They still
contain disconnected graph components; the second also has strand-order errors.
Their reconstruction processes finished, but the reviewer failed validation:

- Target 1 proposed a patch that did not change an already-enabled setting.
- Target 2 omitted a required distinct bottom-strand orientation proposal.

Both failed statuses and their real persisted graph scores are retained. The
existing fail-closed execution condition would prevent promotion independently
of numerical thresholds; no σ comparison has been claimed.

## Validation so far

Stored v3 settings, the single patch, and parent v0 were checked. Prompt rendering
for v0–v3 includes the shared prohibition, and v3 contains the exact conditional
mandatory-skill instruction. Transitive agent imports still cannot reach the
Gate, verifier, Evolver, or setup code. Aggregation keeps both target scores and
both statuses, computes 0.686329, and retains one result per regression protocol.

The final v3 Gate event and the requested fixture export with all three decisions
remain pending the σ definition.
