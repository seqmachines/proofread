# M11 — reviews, authentication, queue, benchmark, and config

Done-when passed on 2026-09-26 against the configured new proofread cluster.
The user approved the §2.5 `error_type` extension before implementation.

## Changes

- Token-derived reviewer identity; authenticated writes, with curator-only
  import/harness actions. All read routes remain public.
- Append-only review capture for states and transitions: accept, modify,
  reject, and unresolved. Modify/reject require one confirmed Table S1 category.
- One MongoDB transaction for repair, one revision bump, downstream stale
  events, isolated GT rescoring, review, human signal, memory candidate, flags,
  and final completion event. Saved benchmark scores remain separate.
- Rejecting a state removes/revises incident transitions with emitted events.
  Stale snapshots and caller-supplied reviewer identities are rejected.
- Unverified memory candidates carry review provenance; matching acceptances
  in two different protocols verify them. The public memory view is verified-only.
- GT disagreement and reviewed-through revision flags; no automatic GT writes.
- `/queue`, `/benchmark`, `/config`, and `EXECUTOR=none`. Review capture requires
  no executor or model. Unsupported live executors return 501.
- Review tokens are removed from executor/reviewer child-process environments.
  The agent import graph still excludes GT, verifier, review, and setup modules.

## Verification

```sh
backend/.venv/bin/python -m backend.check_m11
```

The check starts the API with `EXECUTOR=none`, an empty `CODEX_MODEL`, an
ephemeral review token, and polling SSE mode. An authenticated curl modify:

1. Lands in `reviews` with the server-configured reviewer identity.
2. Revises a state, marks its downstream state stale, and emits `gt_scored`.
3. Creates one `source: human` signal with the confirmed category and review ID.
4. Creates one unverified memory candidate with review provenance.
5. Appears in `/queue` with remaining review work.

The same check exercises unauthorized writes, forged reviewer rejection,
stale revision rollback, required error categories, accept/unresolved without a
revision bump, state/transition rejection, memory verification across protocols,
and all three benchmark grouping modes with separate saved/proofread scores.
Events remain contiguous and end with `run_finished`.

Temporary synthetic test data was removed after verification. The original
20 Codex baseline runs, their IDs and all 989 events remain unchanged. No
benchmark source files, seed bundles, or web files were edited.

Memory curation and GT adjudication UIs, author protocol scoping (M15), and
training export are outside this module. No deployment was performed.
