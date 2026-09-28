# Imported evidence and invite deletion — 2026-09-28

## Result

All 20 benchmark runs were rebuilt from their MongoDB archives under the same
run IDs with `normalization_version: m14.2`. All 174 states now have evidence:
522 links to 60 distinct existing chunks. Every link resolves through the public
`GET /chunks/{id}` route. Both existing reviews, their author attribution,
state/transition IDs, workflow revisions, molecular structures, and both score
sets were preserved.

Each empty imported state commit receives unique chunk IDs from the three
nearest preceding nonempty `evidence_searched` events, newest read first. The
final graph is committed in a batch after these archived traces, so its states
share the nearest context. Existing citations and explicit human changes to
citations are retained. Review edits that left evidence unchanged inherit the
added links in the rebuilt stream; original review documents remain untouched.
No future read is attached to an earlier state. Live runs remain append-only.

Curator-only `DELETE /invites/{invite_id}` returns 204 on deletion and 404 if
absent. Removed tokens fail authentication on subsequent requests; prior
reviews remain. CORS permits authenticated browser DELETE requests.

The exact `panel smoke test` invite, `0341b39d7e71451ab0de7bcefdb1c1fe`, was
deleted through the public API. The `Walkthrough author` invite was retained.

## Validation and deployment

- `python -m backend.check_import_evidence` rebuilt 20 runs, verified preceding
  reads/deduplication, preserved explicit evidence and human edits, refused live
  replacement, and confirmed that a second normalization writes nothing.
- `python -m backend.check_m15` passed, including unauthenticated deletion (401),
  author deletion (403), curator deletion (204), repeated deletion (404), token
  revocation (401), and unchanged saved reviews.
- Public API checks covered all 174 state payloads in snapshots and replay,
  all 60 cited chunks, saved scores for all 20 runs, scoped deletion, immediate
  revocation, and CORS preflight. Temporary verification invites were removed.
- A temporary headless Chrome session opened the published SMART-seq run,
  selected its input state, and displayed three evidence chips with source
  text in the inspector. All three browser chunk requests returned 200.
- Docker build, Python compilation, and `git diff --check` passed.
- Cloud Run revision `proofread-api-00007-rdv` serves 100% of traffic. Public
  `/config` and `/protocols` checks passed.

[SMART-seq run](https://www.acolytics.com/proofread/runs/a5a60a6e623357648a4d11a26ae5ad17)

Reload an already-open run so it replays the rebuilt commits from `since=0`.
SPEC §2.2/§2.7 document the scoped evidence enrichment; §2.6 documents deletion.
