// lib/queue.ts — "runs needing a human" (SPEC.md §6), computed the way GET /queue does:
// unreviewed failed checks (failed verifier checks whose target has no review — or no
// target at all), unresolved items, and the GT score. Used for the offline fixtures;
// the backend's /queue is the source of truth for imported and live runs.
import type { QueueItem } from "./events";
import type { UIState } from "./reducer";

export function queueItemFrom(routeId: string, ui: UIState): QueueItem {
  const reviewed = new Set(ui.reviews.map((r) => r.target_id));
  const unreviewedFailed = ui.checks.filter((c) => c.status === "fail" && (!c.state_id || !reviewed.has(c.state_id))).length;
  const unresolved = ui.nodes.filter((n) => n.data.state.review_status === "unresolved").length;
  const started = ui.trace.length > 0 || ui.runId !== null;
  return {
    run_id: routeId,
    protocol: ui.protocolId ?? "?",
    executor: ui.executor ?? "—",
    harness_version: ui.harnessVersion ?? (started ? "?" : "—"),
    unreviewed_failed_checks: unreviewedFailed,
    unresolved,
    score: ui.gtScore?.structure_f1 ?? null,
  };
}

/** Most need first: unreviewed failed checks, then unresolved items, then the lower score. */
export function sortByNeed(items: QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) =>
      b.unreviewed_failed_checks - a.unreviewed_failed_checks ||
      b.unresolved - a.unresolved ||
      (a.score ?? 1) - (b.score ?? 1) ||
      a.run_id.localeCompare(b.run_id),
  );
}

export const need = (q: QueueItem) => q.unreviewed_failed_checks + q.unresolved;
