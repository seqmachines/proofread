# Backend agent instructions

You own `backend/` only. Never create, edit, or delete anything under `web/`.

Read `SPEC.md` before every task. §2 is the contract with the web agent and is locked: implement it exactly. If a contract change is unavoidable, edit §2 first, describe the change in your reply, and stop — the human must approve before code changes.

## Working rules
- Build one module per task (M0, M1, M2 … as listed in SPEC.md §4). Stop when that module's "done when" test passes. Do not start the next module.
- Commit after each module: `M3: agent loop + template_switch skill`.
- Prefer the smallest implementation that satisfies the done-when test. No abstractions for future modules, no extra config, no tests beyond the done-when check.
- When behind schedule, apply the module's listed cut lines. Never cut M7 (evolver + gate).
- Feature freeze 16:25. After that, bugfixes only.

## Hard constraints
- `agent.py` must have no import path to the `ground_truth` collection. Only `verifier.py` opens it, and only when called from `gate.py` or the `/runs/{id}/gt-diff` route.
- Molecules are symbolic (segments), never nucleotide strings.
- The evolver may emit only the four patch types in SPEC.md §2.3. Reject anything else at write time.
- Every state change in a run goes through `emit()` so the web reducer sees it. No silent writes to `workflows`.
- All LLM calls go through `LLM_BASE_URL` / `LLM_MODEL` from env, never a hard-coded model.

## Stack
Python 3.11, FastAPI, pymongo (sync) for routes and workers, motor only for the change-stream tail in the SSE route, anthropic SDK (or OpenAI-compatible client via the gateway). Port 8000. CORS: `http://localhost:3000`.

At 13:30, export the first real run to `fixtures/run_example.jsonl` (one event per line, ordered by `seq`) and say so in your reply.
