"use client";
// components/BenchmarkPage.tsx — /benchmark (SPEC.md §6): scores by protocol × executor ×
// harness version, with proofread's structure_f1 / edge_f1 and the saved benchmark metrics
// side by side under their own labels; imported baselines and live runs in one table.
// Source: GET /benchmark?group_by=… or, while the backend has none, the fixtures.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BenchmarkRow } from "@/lib/events";
import { API_URL, getBenchmark } from "@/lib/api";
import { FIXTURES, loadFixtureEvents } from "@/lib/fixture";
import { fold } from "@/lib/reducer";
import { type GroupBy, benchmarkMetricNames, groupRows, rowFromRun, sortGrouped } from "@/lib/benchmark";
import { cx } from "@/lib/cx";

type Source = "backend" | "fixtures";
const GROUPS: GroupBy[] = ["run", "protocol", "executor", "version"];

const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40";

const f2 = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(2) : "—");

async function fixtureRows(): Promise<BenchmarkRow[]> {
  const rows = await Promise.all(
    FIXTURES.map(async ({ routeId, name }) => {
      try {
        return rowFromRun(routeId, fold(await loadFixtureEvents(name)));
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is BenchmarkRow => r !== null);
}

export function BenchmarkPage({ initialSource, initialGroup }: { initialSource?: Source; initialGroup?: GroupBy }) {
  const router = useRouter();
  const [state, setState] = useState<{ source: Source; rows: BenchmarkRow[] | null; note: string | null }>({
    source: initialSource ?? "backend",
    rows: null,
    note: null,
  });
  const [groupBy, setGroupBy] = useState<GroupBy>(initialGroup ?? "run");
  const { source, rows, note } = state;

  useEffect(() => {
    let cancelled = false;
    // The backend aggregates server-side (version | executor | protocol); "run" is per fixture run offline.
    const load = source === "backend" ? getBenchmark(groupBy === "run" ? "version" : groupBy) : fixtureRows();
    load
      .then((r) => {
        if (!cancelled) setState((st) => ({ ...st, rows: r }));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        if (source === "backend") setState({ source: "fixtures", rows: null, note: `backend unavailable (${message}) — showing the fixtures` });
        else setState((st) => ({ ...st, rows: [], note: message }));
      });
    return () => {
      cancelled = true;
    };
  }, [source, groupBy]);

  const switchSource = (next: Source) => {
    if (next !== source) setState({ source: next, rows: null, note: null });
  };

  const grouped = rows ? sortGrouped(groupRows(rows, groupBy)) : null;
  const metricNames = rows ? benchmarkMetricNames(rows) : [];
  const open = (id: string | undefined) => {
    if (id) router.push(`/runs/${encodeURIComponent(id)}`);
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="font-mono text-muted">benchmark</span>
        <span className="ml-3 font-mono text-[10px] text-muted">source</span>
        <button className={cx(btn, source === "backend" && "border-accent text-accent")} onClick={() => switchSource("backend")} title={`${API_URL}/benchmark`}>
          backend
        </button>
        <button className={cx(btn, source === "fixtures" && "border-accent text-accent")} onClick={() => switchSource("fixtures")} title="fixtures/*.jsonl">
          fixtures
        </button>
        <span className="ml-3 font-mono text-[10px] text-muted">group by</span>
        {GROUPS.map((g) => (
          <button key={g} className={cx(btn, groupBy === g && "border-accent text-accent")} onClick={() => setGroupBy(g)} data-group={g}>
            {g}
          </button>
        ))}
        {note && (
          <span className="max-w-[30rem] truncate font-mono text-[10px] text-muted" title={note}>
            {note}
          </span>
        )}
        <span className="ml-auto flex gap-3 font-mono text-[11px] text-muted">
          <Link href="/queue" className="underline decoration-line hover:text-foreground">
            queue
          </Link>
          <Link href="/harness" className="underline decoration-line hover:text-foreground">
            harness
          </Link>
        </span>
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[1100px]">
          <div className="mb-2 font-mono text-[11px] text-muted">
            scores by protocol × executor × harness version · <span className="text-foreground">proofread</span> = structure_f1 / edge_f1 from gt_scored ·{" "}
            <span className="text-foreground">benchmark</span> = saved record metrics under their original names (t3_state_f1 is not structure_f1)
          </div>
          {grouped === null && !note && <div className="font-mono text-[11px] text-muted">loading…</div>}
          {grouped && grouped.length === 0 && <div className="font-mono text-[11px] text-muted">no scored runs</div>}
          {grouped && grouped.length > 0 && (
            <table className="w-full border-collapse text-[12px]" data-benchmark>
              <thead>
                <tr className="font-mono text-[9px] tracking-wide text-muted uppercase">
                  <th colSpan={5} className="border-b border-line pb-0.5 text-left font-normal"></th>
                  <th colSpan={2} className="border-b border-line pb-0.5 text-right font-normal text-foreground">
                    proofread
                  </th>
                  <th colSpan={Math.max(1, metricNames.length + 1)} className="border-b border-line pb-0.5 pl-4 text-right font-normal text-foreground">
                    benchmark
                  </th>
                </tr>
                <tr className="border-b border-line font-mono text-[10px] tracking-wide text-muted uppercase">
                  <th className="py-1 pr-3 text-left font-normal">{groupBy === "run" ? "run" : groupBy}</th>
                  <th className="py-1 pr-3 text-left font-normal">protocol</th>
                  <th className="py-1 pr-3 text-left font-normal">executor</th>
                  <th className="py-1 pr-3 text-left font-normal">harness</th>
                  <th className="py-1 pr-3 text-right font-normal">runs</th>
                  <th className="py-1 pr-3 text-right font-normal">structure_f1</th>
                  <th className="py-1 pr-3 text-right font-normal">edge_f1</th>
                  {metricNames.map((m) => (
                    <th key={m} className="py-1 pl-4 text-right font-normal">
                      {m}
                    </th>
                  ))}
                  <th className="py-1 pl-4 text-right font-normal">version</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => (
                  <tr
                    key={g.key}
                    data-benchmark-row={g.key}
                    onClick={() => open(g.run_id)}
                    className={cx("border-b border-line/60", g.run_id && "cursor-pointer hover:bg-panel")}
                    title={g.run_id ? `open /runs/${g.run_id}` : `${g.runs} runs: ${g.run_ids?.join(", ")}`}
                  >
                    <td className="max-w-[14rem] truncate py-1.5 pr-3 font-mono text-[11px]">
                      {groupBy === "run" ? (g.run_id ?? g.key) : g.key}
                      {g.source && (
                        <span className="ml-1.5 rounded-sm border border-line px-1 text-[9px] text-muted" title="run source">
                          {g.source}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{g.protocol || "—"}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{g.executor || "—"}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{g.harness_version || "—"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums">{g.runs}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums">{f2(g.structure_f1)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-[11px] text-muted tabular-nums">{f2(g.edge_f1)}</td>
                    {metricNames.map((m) => (
                      <td key={m} className="py-1.5 pl-4 text-right font-mono text-[11px] tabular-nums">
                        {f2(g.benchmarkMeans[m])}
                      </td>
                    ))}
                    <td className="py-1.5 pl-4 text-right font-mono text-[11px] text-muted">{g.benchmarkVersions.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
