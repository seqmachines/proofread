"use client";
// components/QueuePage.tsx — /queue (SPEC.md §6): runs needing a human, sorted by
// unreviewed failed checks and unresolved items; click a row → the run. Live data only
// (GET /queue), with a text filter and refresh.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/events";
import { API_URL, getQueue } from "@/lib/api";
import { need, sortByNeed } from "@/lib/queue";
import { cx } from "@/lib/cx";
import { isAuthor, useReviewer } from "@/lib/reviewer";

const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40";
const field =
  "h-6 w-56 rounded border border-line bg-panel px-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted/70 focus:border-accent";

/** "benchmark:libgen/codex/libgen-gpt-5-6-sol" → "libgen-gpt-5-6-sol" for the cell; the full id stays in the title. */
const shortVersion = (v: string) => (v.includes("/") ? v.slice(v.lastIndexOf("/") + 1) : v);

function NeedBar({ q, max }: { q: QueueItem; max: number }) {
  const n = need(q);
  const w = max > 0 ? Math.round((n / max) * 64) : 0;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${q.unreviewed_failed_checks} unreviewed failed checks + ${q.unresolved} unresolved`}>
      <span className="inline-block h-1.5 w-16 rounded-sm bg-line">
        <span className={cx("block h-1.5 rounded-sm", n > 0 ? "bg-rose-500" : "bg-emerald-500")} style={{ width: w }} />
      </span>
      <span className="w-6 text-right font-mono tabular-nums">{n}</span>
    </span>
  );
}

export function QueuePage() {
  const reviewer = useReviewer();
  const router = useRouter();
  const [state, setState] = useState<{ items: QueueItem[] | null; error: string | null; at: string | null }>({ items: null, error: null, at: null });
  const [filter, setFilter] = useState("");
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    getQueue()
      .then((q) => {
        if (!cancelled) setState({ items: sortByNeed(q), error: null, at: new Date().toISOString().slice(11, 19) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState((st) => ({ ...st, error: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => load(), [load, tick]);

  const { items, error, at } = state;
  const needle = filter.trim().toLowerCase();
  const shown = (items ?? []).filter((q) => !needle || [q.run_id, q.protocol, q.executor, q.harness_version].some((v) => v.toLowerCase().includes(needle)));
  const max = Math.max(0, ...(items ?? []).map(need));
  const openRun = (id: string) => router.push(`/runs/${encodeURIComponent(id)}`);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="font-mono text-muted">queue</span>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter run · protocol · executor · harness" className={cx(field, "ml-3")} aria-label="Filter queue" />
        {items && (
          <span className="font-mono text-[10px] text-muted tabular-nums" data-queue-count={items.length}>
            {shown.length === items.length ? `${items.length} runs` : `${shown.length} of ${items.length} runs`}
            {at ? ` · ${at}` : ""}
          </span>
        )}
        <button className={btn} onClick={() => setTick((t) => t + 1)} title={`GET ${API_URL}/queue`}>
          refresh
        </button>
        <span className="ml-auto flex gap-3 font-mono text-[11px] text-muted">
          <Link href="/memory" className="underline decoration-line hover:text-foreground">
            memory
          </Link>
          <Link href="/benchmark" className="underline decoration-line hover:text-foreground">
            benchmark
          </Link>
          {!isAuthor(reviewer) && (
            <Link href="/harness" className="underline decoration-line hover:text-foreground">
              harness
            </Link>
          )}
        </span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[1000px]">
          <div className="mb-2 font-mono text-[11px] text-muted">
            runs needing a human · sorted by unreviewed failed checks, then unresolved items, then lowest score
          </div>
          {error && (
            <div className="mb-2 rounded border border-rose-600/40 bg-rose-600/10 px-2 py-1 font-mono text-[11px] text-rose-600 dark:text-rose-400" data-queue-error>
              {error}
            </div>
          )}
          {items === null && !error && <div className="font-mono text-[11px] text-muted">loading…</div>}
          {items && items.length === 0 && <div className="font-mono text-[11px] text-muted">nothing needs a review</div>}
          {items && items.length > 0 && shown.length === 0 && <div className="font-mono text-[11px] text-muted">no runs match the filter</div>}
          {shown.length > 0 && (
            <table className="w-full border-collapse text-[12px]" data-queue>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-wide text-muted uppercase">
                  <th className="py-1 pr-3 text-left font-normal">need</th>
                  <th className="py-1 pr-3 text-left font-normal">protocol</th>
                  <th className="py-1 pr-3 text-left font-normal">run</th>
                  <th className="py-1 pr-3 text-left font-normal">executor</th>
                  <th className="py-1 pr-3 text-left font-normal">harness</th>
                  <th className="py-1 pr-3 text-right font-normal">failed · unreviewed</th>
                  <th className="py-1 pr-3 text-right font-normal">unresolved</th>
                  <th className="py-1 text-right font-normal">structure_f1</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((q, i) => (
                  <tr
                    key={q.run_id}
                    data-queue-row={q.run_id}
                    data-rank={i + 1}
                    tabIndex={0}
                    role="link"
                    onClick={() => openRun(q.run_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openRun(q.run_id);
                    }}
                    className="cursor-pointer border-b border-line/60 hover:bg-panel focus:bg-panel focus:outline-none"
                    title={`open /runs/${q.run_id}`}
                  >
                    <td className="py-1.5 pr-3">
                      <NeedBar q={q} max={max} />
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{q.protocol}</td>
                    <td className="max-w-[9rem] truncate py-1.5 pr-3 font-mono text-[11px] text-muted" title={q.run_id}>
                      {q.run_id}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{q.executor}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted" title={q.harness_version}>
                      {shortVersion(q.harness_version)}
                    </td>
                    <td className={cx("py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums", q.unreviewed_failed_checks > 0 && "text-rose-600 dark:text-rose-400")}>
                      {q.unreviewed_failed_checks}
                    </td>
                    <td className={cx("py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums", q.unresolved > 0 && "text-amber-600 dark:text-amber-400")}>
                      {q.unresolved}
                    </td>
                    <td className="py-1.5 text-right font-mono text-[11px] tabular-nums">{q.score === null ? "—" : q.score.toFixed(2)}</td>
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
