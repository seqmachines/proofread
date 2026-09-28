"use client";
// components/BenchmarkPage.tsx — /benchmark (SPEC.md §6): scores by version × executor ×
// protocol, with proofread's gt_score (structure_f1 / edge_f1) and the saved benchmark_score
// side by side under their own labels. Live data only: the three GET /benchmark?group_by=
// aggregations, one table each.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { BenchmarkRow } from "@/lib/events";
import { API_URL, type BenchmarkGroupBy, getBenchmark } from "@/lib/api";
import { benchmarkMetricNames } from "@/lib/benchmark";
import { cx } from "@/lib/cx";
import { isAuthor, useReviewer } from "@/lib/reviewer";

const GROUPS: { key: BenchmarkGroupBy; label: string; field: keyof BenchmarkRow }[] = [
  { key: "version", label: "harness version", field: "harness_version" },
  { key: "executor", label: "executor", field: "executor" },
  { key: "protocol", label: "protocol", field: "protocol" },
];

// The §2.1 metrics first, then anything else the record carries.
const METRIC_ORDER = ["t2_required_family_f1", "t3_molecular_transition_f1", "t3_state_f1", "t3_typed_edge_f1"];
const f2 = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(2) : "—");
const shortVersion = (v: string) => (v.includes("/") ? v.slice(v.lastIndexOf("/") + 1) : v);

function GroupTable({ group, rows }: { group: (typeof GROUPS)[number]; rows: BenchmarkRow[] }) {
  const names = benchmarkMetricNames(rows).sort((a, b) => {
    const ia = METRIC_ORDER.indexOf(a);
    const ib = METRIC_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const sorted = [...rows].sort((a, b) => (b.structure_f1 ?? -1) - (a.structure_f1 ?? -1) || (b.runs ?? 0) - (a.runs ?? 0));
  return (
    <section className="mb-6" data-benchmark-group={group.key}>
      <h2 className="mb-1 font-mono text-[10px] tracking-widest text-muted uppercase">by {group.label}</h2>
      {rows.length === 0 && <div className="font-mono text-[11px] text-muted">no scored runs</div>}
      {rows.length > 0 && (
        <table className="w-full border-collapse text-[12px]" data-benchmark>
          <thead>
            <tr className="font-mono text-[9px] tracking-wide text-muted uppercase">
              <th colSpan={2} className="border-b border-line pb-0.5 text-left font-normal"></th>
              <th colSpan={3} className="border-b border-line pb-0.5 text-right font-normal text-foreground" title="proofread's verifier scores (gt_scored)">
                gt_score · proofread
              </th>
              <th colSpan={Math.max(1, names.length + 1)} className="border-b border-line pb-0.5 pl-4 text-right font-normal text-foreground" title="saved benchmark metrics under their original names">
                benchmark_score · record
              </th>
            </tr>
            <tr className="border-b border-line font-mono text-[10px] tracking-wide text-muted uppercase">
              <th className="py-1 pr-3 text-left font-normal">{group.label}</th>
              <th className="py-1 pr-3 text-right font-normal">runs</th>
              <th className="py-1 pr-3 text-right font-normal">gt-scored</th>
              <th className="py-1 pr-3 text-right font-normal">structure_f1</th>
              <th className="py-1 pr-3 text-right font-normal">edge_f1</th>
              {names.map((m) => (
                <th key={m} className="py-1 pl-4 text-right font-normal">
                  {m}
                </th>
              ))}
              <th className="py-1 pl-4 text-right font-normal">version</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const key = String(r[group.field] ?? i);
              return (
                <tr key={key} data-benchmark-row={key} className="border-b border-line/60">
                  <td className="py-1.5 pr-3 font-mono text-[11px]" title={key}>
                    {group.key === "version" ? shortVersion(key) : key}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums">{r.runs ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-[11px] text-muted tabular-nums">{r.gt_scored_runs ?? "—"}</td>
                  <td className={cx("py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums", r.structure_f1 == null && "text-muted")}>{f2(r.structure_f1)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-[11px] text-muted tabular-nums">{f2(r.edge_f1)}</td>
                  {names.map((m) => (
                    <td key={m} className="py-1.5 pl-4 text-right font-mono text-[11px] tabular-nums">
                      {f2(r.benchmark?.metrics?.[m])}
                    </td>
                  ))}
                  <td className="py-1.5 pl-4 text-right font-mono text-[11px] text-muted">{r.benchmark?.benchmark_version ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function BenchmarkPage() {
  const reviewer = useReviewer();
  const [state, setState] = useState<{ data: Record<BenchmarkGroupBy, BenchmarkRow[]> | null; error: string | null }>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all(GROUPS.map((g) => getBenchmark(g.key)))
      .then(([version, executor, protocol]) => {
        if (!cancelled) setState({ data: { version, executor, protocol }, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, error } = state;
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="font-mono text-muted">benchmark</span>
        <span className="ml-auto flex gap-3 font-mono text-[11px] text-muted">
          <Link href="/queue" className="underline decoration-line hover:text-foreground">
            queue
          </Link>
          <Link href="/memory" className="underline decoration-line hover:text-foreground">
            memory
          </Link>
          {!isAuthor(reviewer) && (
            <Link href="/harness" className="underline decoration-line hover:text-foreground">
              harness
            </Link>
          )}
        </span>
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[1100px]">
          <div className="mb-3 font-mono text-[11px] text-muted">
            scores by version × executor × protocol · <span className="text-foreground">gt_score</span> = proofread structure_f1 / edge_f1 ·{" "}
            <span className="text-foreground">benchmark_score</span> = the metrics saved with the record (t3_state_f1 is not structure_f1) · source {API_URL}/benchmark
          </div>
          {error && (
            <div className="rounded border border-rose-600/40 bg-rose-600/10 px-2 py-1 font-mono text-[11px] text-rose-600 dark:text-rose-400" data-benchmark-error>
              {error}
            </div>
          )}
          {data === null && !error && <div className="font-mono text-[11px] text-muted">loading…</div>}
          {data && GROUPS.map((g) => <GroupTable key={g.key} group={g} rows={data[g.key]} />)}
        </div>
      </main>
    </div>
  );
}
