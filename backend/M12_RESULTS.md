# M12 — Text retrieval

Done-when passed on 2026-09-26 against the new configured Atlas cluster.

## Changes

- Deleted the embedding client and all embedding calls/settings. Removed the
  four embedding settings from the local, untracked `backend/.env` as well.
- `python -m backend.db` initializes all eleven §3 collections, their indexes,
  the protocol-prefixed `chunks_text` text index, and v0 with full history.
  Setup also removes legacy vector indexes and stored chunk vectors. The new
  cluster was empty and had no vector index to remove.
- `search_evidence` uses protocol-filtered MongoDB text search with relevance
  ranking and stable ID tie-breaking. Results retain `{chunk_id, page, snippet}`.
- Added the previously missing `list_sources` and `read_page` MCP tools. Page
  reads are restricted to the run's protocol and emit `evidence_searched`.
- Source extraction stores `kind: page` or `table`, with no embedding fields.
  Runtime agent imports remain isolated from setup, seed, verifier and Gate.

## Verification

From the repository root, with no `EMBED_*` or `VOYAGE_*` settings:

```sh
backend/.venv/bin/python -m backend.db
backend/.venv/bin/python -m backend.seed
backend/.venv/bin/python -m backend.check_m12
```

Initialization passed and was repeatable. The six local source bundles seeded
269 chunks and six GT records without a provider call. Retrieval checks covered
source enumeration, full table reads, deterministic text ranking, empty search
results, and rejection of another protocol's page ID.

The live Smart-seq2 check used the configured Codex model and the normal MCP,
verifier, and reviewer paths. Evolution was disabled for this retrieval check;
no Gate baselines or candidate experiments were needed on the new cluster.

| Field | Result |
|---|---|
| Run ID | `c00e330efbd4448aa67020898c552cc3` |
| Source / executor / harness | live / codex / v0 |
| Status | done |
| States / transitions | 8 / 7 |
| Events | 115, contiguous; `run_finished` last |
| Retrieval | 28 page/table reads and 1 text search |
| Verifier passes | graph_connected, substrate_exists, provenance_present |
| Verifier findings | oligos_represented, strand_consistency |

The scientific findings remain recorded; passing M12 establishes completion of
the retrieval and reconstruction path, not a perfect molecular reconstruction.

An earlier attempt, `8007a96747c745428372376c9389ef92`, finished reconstruction
but failed verification because the new chunk projection omitted `protocol_id`.
That projection was corrected before the successful run; the failed attempt is
preserved in the event log.

No contract or web changes were made. M10 and M11 remain separate tasks under
the updated module order.

The subsequent user-requested 20-Codex-baseline cleanup removed both M12 test
runs and unused protocol data from the new cluster. The local seed bundles and
this verification record remain available; see `M10_RESULTS.md` for the cleanup.
