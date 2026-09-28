# M15 backend and reviewer walkthrough — 2026-09-28

## Result

The scoped-author done-when check passed against Atlas. An invite token records
an attributed review for its protocol (200) and is rejected on another (403).
Only curators create/list invites. Tokens are returned once; MongoDB stores
SHA-256 digests. Legacy author tokens without a protocol scope cannot write.

`EXECUTOR=none` returns 501 for authenticated chat requests without invoking
an executor or emitting events. Typed reviews continue to work.

## Reviewer fixes

- **Canonical GT comparison:** segment structure and operation/endpoint alignment
  produce 158 matched state pairs and 116 matched transition pairs across the
  20 saved baselines. The response includes both full objects and similarity,
  plus 16 unmatched GT states, 16 unmatched predicted states, 12 unmatched GT
  transitions, and 48 unmatched predicted transitions. Existing typed-edge
  differences remain. Recomputed verifier scores equal every saved score.
- **Frozen evidence:** verified 20 manifest hashes and all 58 document hashes at
  their pinned input revision. Seeded 1,947 chunks. Large barcode spreadsheets
  are divided into bounded row sections. All 529 existing trajectory chunk
  references resolve. No graph citations were invented.
- **Verifier wording:** all 591 saved findings display names as words and plain
  messages without internal IDs, paths, or triage metadata. API snapshots,
  event replay, and SSE share the same formatting. Stored logs retain their
  original machine keys and messages.
- **Contract:** SPEC §0 records the setup-only frozen-bundle exception for
  `seed.py`; the importer still reads only `runs/`. §2.6 records canonical diff
  pairs, public message formatting, disabled chat, invites, and write scopes.

## Checks

- `python -m backend.check_m15`: canonical matching survives renamed IDs;
  altered operations/endpoints reduce agreement; unmatched objects are reported.
  An author can review its protocol, cannot review another, and cannot import,
  change harnesses, or administer invites. Missing/invalid tokens and forged
  reviewer fields are rejected. Disabled requests write no events.
- The same check validates SMART-seq's API diff and public findings, checks all
  20 protocols' seeded chunks and all existing evidence references, and deletes
  only its synthetic runs, review, and invite. The saved 20 runs are unchanged.
- Read-only comparison of all 20 workflows confirmed unchanged verifier scores.
- `docker build -t proofread-backend:m15 backend` passed. The upload manifest
  includes `verifier_text.py` and excludes credentials, seed files, and checks.
- Python compilation and `git diff --check` passed.

## Public deployment

Cloud Run revision `proofread-api-00006-jqw` serves 100% of traffic in
`gen-lang-client-0325887617`, `us-east4`.

- [Config](https://proofread-api-7jj27cadja-uk.a.run.app/config): executor `none`,
  live runs disabled, stream mode `stream`.
- [Protocols](https://proofread-api-7jj27cadja-uk.a.run.app/protocols): 20 protocols
  with 20 saved sources. Public canonical diffs and a frozen source chunk from
  every protocol passed. `/benchmark` still reports all 20 verifier scores.
- [SMART-seq GT diff](https://proofread-api-7jj27cadja-uk.a.run.app/runs/a5a60a6e623357648a4d11a26ae5ad17/gt-diff):
  matched pairs and unmatched objects returned; its public SSE replay equals the
  formatted event response and its workflow snapshot.
- A curator created an invite through the public endpoint. Its author token
  recorded a review (200), received 403 for another protocol and curator routes,
  and received 501 for chat. Denied/disabled requests emitted no events.
- All temporary deployment-check records were removed. The original 20 runs
  retained their event counts and saved scores.
