// lib/benchmark.ts — Benchmark view data: one row per run (protocol × executor × harness
// version) carrying proofread's structure_f1 / edge_f1 and the saved benchmark metrics side
// by side, plus grouping with means. Fixture rows come from fold(events); backend rows
// from GET /benchmark.
import type { BenchmarkRow } from "./events";
import type { UIState } from "./reducer";

export type GroupBy = "run" | "protocol" | "executor" | "version";

export function rowFromRun(routeId: string, ui: UIState, source = "fixture"): BenchmarkRow {
  return {
    run_id: routeId,
    protocol: ui.protocolId ?? "?",
    executor: ui.executor ?? "—",
    harness_version: ui.harnessVersion ?? "?",
    source: ui.source ?? source,
    runs: 1,
    structure_f1: ui.gtScore?.structure_f1 ?? null,
    edge_f1: ui.gtScore?.edge_f1 ?? null,
    benchmark: ui.benchmarkScore,
  };
}

const mean = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const uniq = (xs: (string | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));

/** Every metric name seen across rows' saved benchmark scores, in first-seen order. */
export function benchmarkMetricNames(rows: BenchmarkRow[]): string[] {
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.benchmark?.metrics ?? {})) if (!names.includes(k)) names.push(k);
  return names;
}

export interface GroupedRow extends BenchmarkRow {
  key: string;
  members: BenchmarkRow[];
  benchmarkMeans: Record<string, number | null>;
  benchmarkVersions: string[];
}

export function groupRows(rows: BenchmarkRow[], by: GroupBy): GroupedRow[] {
  const keyOf = (r: BenchmarkRow) =>
    by === "run"
      ? (r.run_id ?? r.run_ids?.join(",") ?? `${r.protocol}|${r.executor}|${r.harness_version}`)
      : by === "protocol"
        ? (r.protocol ?? "?")
        : by === "executor"
          ? (r.executor ?? "?")
          : (r.harness_version ?? "?");
  const groups = new Map<string, BenchmarkRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const metricNames = benchmarkMetricNames(rows);
  return Array.from(groups, ([key, members]) => ({
    key,
    members,
    run_id: members.length === 1 ? members[0].run_id : undefined,
    run_ids: members.flatMap((m) => m.run_ids ?? (m.run_id ? [m.run_id] : [])),
    protocol: uniq(members.map((m) => m.protocol)).join(", "),
    executor: uniq(members.map((m) => m.executor)).join(", "),
    harness_version: uniq(members.map((m) => m.harness_version)).join(", "),
    source: uniq(members.map((m) => m.source)).join(", "),
    runs: members.reduce((n, m) => n + (m.runs ?? 1), 0),
    structure_f1: mean(members.map((m) => m.structure_f1)),
    edge_f1: mean(members.map((m) => m.edge_f1)),
    benchmark: null,
    benchmarkMeans: Object.fromEntries(metricNames.map((k) => [k, mean(members.map((m) => m.benchmark?.metrics?.[k]))])),
    benchmarkVersions: uniq(members.map((m) => m.benchmark?.benchmark_version)),
  }));
}

/** Highest proofread score first, then most runs, then key — so the best configuration reads first. */
export function sortGrouped(rows: GroupedRow[]): GroupedRow[] {
  return [...rows].sort((a, b) => (b.structure_f1 ?? -1) - (a.structure_f1 ?? -1) || (b.runs ?? 0) - (a.runs ?? 0) || a.key.localeCompare(b.key));
}
