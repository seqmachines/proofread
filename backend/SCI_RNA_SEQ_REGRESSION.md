# sci-RNA-seq v1 regression diagnosis

Compared the persisted runs against the native local Task 3 record in
`backend/seed/sci_rna_seq/ground_truth.json`, using the current sequence-free
converter and scorer. The local scores reproduce the stored Gate scores.
No workflow, signal, harness, or score was changed in MongoDB for this analysis.

| Run | Version | structure_f1 | edge_f1 |
| --- | --- | ---: | ---: |
| `a0fc0f6423b54a96ae4a7143c0113ab2` | v0 | 0.674697 | 0.777778 |
| `3a1a1c1d63314e489d139bb1d8037981` | v1 | 0.603904 | 0.500000 |

## Main finding

The dominant observed regression is the unsupported template-switching state
`S_69cd7b76c851` and transition `tr_tso`. GT has no template-switching operation.
Its RT product, `st_mrna_cdna_hybrid`, is an **RNA/DNA hybrid**, matching the
skill's architecture. GT continues directly to second-strand synthesis.

The trace explicitly identifies the instruction conflict. At seq 36 the agent
records that the source does not report template switching, but that it invokes
the required skill as a “task-mandated modeling addition.” It successfully calls
`template_switch` at seq 55 and commits its product. This is stronger evidence
than inferring the cause from a lower score alone.

`harness.render()` currently says “You must call template_switch through
run_skill for template_switching.” The agent applied that instruction even
without a source-supported operation. §2.6 requires a successful skill call
**when committing that operation**; it does not require adding the operation
to every protocol. The mandatory instruction should preserve that condition.

## RT representation contributes less

The RT skill takes a primer name and collapses its internal structure into one
`primer` segment. Native GT resolves the cDNA into, in 5′→3′ order: Read 1/w1
adapter, UMI, RT barcode, oligo-dT, insert. The committed input RNA also lacks a
separate poly(A) segment, so its missing tail is inherited by the skill.

The matched RT-state similarity drops from **0.833333** in v0 to **0.810714** in
v1. That is a real limitation, but it does not account for most of the regression.
There is no evidence here for changing the RT product to single-stranded DNA.

## Counterfactual scoring, local copies only

Each row changes only the named part of the saved v1 graph. These are diagnostic
score calculations, not fresh agent runs or evidence of future model behavior.

| Change to v1 | structure_f1 | Change from v1 | edge_f1 |
| --- | ---: | ---: | ---: |
| None | 0.603904 | — | 0.500000 |
| Replace RT state with v0's RT state | 0.607674 | +0.003770 | 0.500000 |
| Expand RT bottom segments to symbolic GT | 0.625868 | +0.021964 | 0.500000 |
| Replace the whole RT state with symbolic GT | 0.635451 | +0.031547 | 0.500000 |
| Remove unsupported TS state/transition; reconnect RT to second strand | 0.658804 | +0.054900 | 0.777778 |

Even replacing the entire RT state with GT does not recover the v0 score.
Removing the unsupported TS step recovers about 78% of the 0.070793 structure
regression and all of the edge regression. These effects are not assumed to be
additive: alignment and the state-count denominator can change between variants.
Other differences include weaker tagmented-state similarity (0.750000 →
0.662500). Both runs omit the GT gap-fill intermediate.

No RT skill change or v3 Gate was launched under the premise that RT was the
main cause. A retry should first correct the operation scope of the mandatory
instruction, then evaluate `template_switch: mandatory` alone. Expanding primer
segments requires source-grounded structured inputs; it should not copy GT or
hard-code a sci-RNA-seq primer into the generic skill.
