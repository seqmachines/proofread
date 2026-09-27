# M3 results — Smart-seq2

2026-09-26. M3 passed, followed by two independent repeats. All three used
`smart_seq2`, harness `v0`, `history: full`, `evidence_k: 5`, and Codex CLI
0.155.1 with `CODEX_MODEL=gpt-6-luna` and low reasoning effort. The two repeats
used identical code and harness settings, with fresh temporary directories.

| Run | ID | States | Transitions | Events | Seconds | M3 check |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Initial successful run | `468e160ab2914beda980a1a9fad8a6a9` | 7 | 5 | 71 | 162.7 | Passed |
| Repeat 1 | `ccb047a9b74f4abc953f2df43f86b74a` | 6 | 5 | 49 | 129.6 | Passed |
| Repeat 2 | `eb714aed407a42439a02faf9a9151f1d` | 5 | 4 | 40 | 243.4 | Passed |

Each check started the run through `POST /runs`, received contiguous SSE
sequence numbers from 1 through `run_finished`, and confirmed `status: done`
with at least five persisted states. Input + output usage reported by the CLI
was 1,119,244, 712,652, and 749,262 tokens respectively, including cached input.
These are aggregate CLI-turn counts, not billed-cost estimates.

## Did the failures reproduce?

The exact initial failures did **not** consistently reproduce:

| Observation | Initial run | Repeat 1 | Repeat 2 |
| --- | --- | --- | --- |
| Sequence-bearing evidence query blocked | Yes, seq 21 | Yes, seq 6 | No |
| Invalid RT substrate rejected by skill | Yes, seq 33; recovered at seq 40 | No skill calls | No; RT succeeded at seq 16 |
| Disconnected committed state | `state_rna_dtoligo` is isolated | No; one chain | No; one chain |
| Transition submitted before both endpoints existed | No | Yes, seq 21; recovered at seq 24 | No |

Both repeats skipped the optional `template_switch` skill, but the resulting
graphs differed:

- Repeat 1 combined reverse transcription and template switching into
  `reverse_transcription_template_switch`, typed `template_switching`, with no
  separate `reverse_transcription` edge or pre-switch cDNA state. Its TSO,
  insert, and primer-derived parts are bundled into one segment in `ts_cdna`.
- Repeat 2 used `reverse_transcribe`, then jumped from the RNA/cDNA hybrid to
  `cdna_amp` through `pcr_cdna`. It has no `template_switching` edge or separate
  template-switched product. The PCR product nevertheless contains a named
  TSO-derived handle.

Thus incomplete separation of RT/template-switching stages recurred across
the two repeats; the exact missing stage and graph shape were variable.
Skipping an optional skill is allowed by v0 and is not itself a guardrail
failure. These observations come from stored graphs and tool events, not from
ground-truth scoring. M4 verification and M6 review remain unimplemented hooks.

Inspect snapshots at `GET /runs/<id>` and replay at
`GET /runs/<id>/stream?since=0&speed=8` on port 8000.

## Development fixes before the repeats

An earlier integration attempt (`906f3e7e7fdb48719aa5177988be1484`) stopped before
any states were committed because MCP tools required interactive approval.
The executor now grants approval only to the enabled proofread tools for the
current run; the sandbox remains read-only, with shell and web access disabled.

The initial successful run exposed a validation-message bug: Pydantic echoed
a rejected nucleotide query into its error event. Error reporting was changed
to omit input values before both repeats. Repeat 1 exercised that fix. No
prompt, skill, model, or harness-policy changes were made between these runs.

The three reconstruction runs above preceded the later contract request for
optional transition oligos/discarded fields and the revised M4/M7 definitions.
The approved optional fields were subsequently added to the tool schema and
transition validation. The converter was checked against all six local Task 3
records and the converted records were refreshed in Atlas without re-embedding.
Discarded products are preserved separately from carried products; the
Plate scATAC-seq conversion has two discarded-product links. No M4 or M7 code
was added.
