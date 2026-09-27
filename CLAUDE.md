# Web agent instructions

You own `web/` and `fixtures/run_example.jsonl` only. Never create, edit, or delete anything under `backend/`.

Read `SPEC.md` before every task. §2 is the contract with the backend agent and is locked: type everything to it exactly (`lib/events.ts` mirrors §2.2, §2.1, §2.3, §2.4). If a contract change is unavoidable, edit §2 first, describe the change in your reply, and stop — the human must approve before code changes.

## Working rules
- Build one module per task (F0, F1, F2 … as listed in SPEC.md §5). Stop when that module's "done when" test passes. Do not start the next module.
- Commit after each module: `F1: canvas + MoleculeNode`.
- Until the human says "backend is live" (~13:30), all data comes from `fixtures/run_example.jsonl`. Write that fixture first, meeting the minimums in SPEC.md §2.2. Keep the fixture path working after going live — it is the offline demo fallback.
- UI state is always `fold(events)` (`lib/reducer.ts`). Components never hold workflow state of their own. Replay, live, and reconnect all go through the same reducer.
- Node positions are assigned once at `state_committed` and never recomputed. No auto-layout library.
- When behind schedule, apply the module's listed cut lines. Cut polish before behavior.
- Feature freeze 16:25. After that, bugfixes only.

## Design direction
Scientific workbench, not a dashboard. The canvas is the hero; the trace is secondary; chat is a thin bar at the bottom. Dense, quiet, monospaced numerals, light and dark themes. No KPI cards, no charts, no marketing gradients. The colored segment blocks inside each molecule node are the visual identity — make them crisp, aligned across the two strands, and legible on a projector at 1080p. Use the segment colors in SPEC.md §2.7 exactly. Stale states at 40% opacity; ghost states with a dashed border. Every clickable element answers "where did this come from?"

## Stack
Next.js app router, TypeScript, Tailwind, `@xyflow/react`. Port 3000. Backend at `http://localhost:8000`; read from `NEXT_PUBLIC_API_URL` with that default. SSE via `EventSource` with reconnect from last `seq`; polling fallback when `NEXT_PUBLIC_STREAM_MODE=poll`.
