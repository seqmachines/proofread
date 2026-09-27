"use client";
// components/QueuePage.tsx — /queue (SPEC.md §6): runs needing a human, sorted by
// unreviewed failed checks and unresolved items; click a row → the run.
// Source: GET /queue (imported baselines + live runs) or, when the backend has no
// queue yet / is unreachable, the offline fixtures folded through the same rule.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/events";
import { API_URL, getQueue } from "@/lib/api";
import { FIXTURES, loadFixtureEvents } from "@/lib/fixture";
import { fold } from "@/lib/reducer";
import { need, queueItemFrom, sortByNeed } from "@/lib/queue";
import { cx } from "@/lib/cx";

type Source = "backend" | "fixtures";


const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40";

async function fixtureQueue(): Promise<QueueItem[]> {
  const items = await Promise.all(
    FIXTURES.map(async ({ routeId, name }) => {
      try {
        return queueItemFrom(routeId, fold(await loadFixtureEvents(name)));
      } catch {
        return null;
      }
    }),
  );
  return sortByNeed(items.filter((x): x is QueueItem => x !== null));
}

function NeedBar({ q, max }: { q: QueueItem; max: number }) {
  const n = need(q);
  const w = max > 0 ? Math.round((n / max) * 64) : 0;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${q.unreviewed_failed_checks} unreviewed failed checks + ${q.unresolved} unresolved`}>
      <span className="inline-block h-1.5 w-16 rounded-sm bg-line">
        <span className={cx("block h-1.5 rounded-sm", n > 0 ? "bg-rose-500" : "bg-emerald-500")} style={{ width: w }} />
      </span>
      <span className="w-5 text-right font-mono tabular-nums">{n}</span>
    </span>
  );
}

export function QueuePage({ initialSource }: { initialSource?: Source }) {
  const router = useRouter();
  const [state, setState] = useState<{ source: Source; items: QueueItem[] | null; note: string | null }>({
    source: initialSource ?? "backend",
    items: null,
    note: null,
  });
  const { source, items, note } = state;

  useEffect(() => {
    let cancelled = false;
    const load = source === "backend" ? getQueue().then(sortByNeed) : fixtureQueue();
    load
      .then((q) => {
        if (!cancelled) setState((st) => ({ ...st, items: q }));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        if (source === "backend") setState({ source: "fixtures", items: null, note: `backend unavailable (${message}) — showing the fixtures` });
        else setState((st) => ({ ...st, items: [], note: message }));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const switchSource = (next: Source) => {
    if (next !== source) setState({ source: next, items: null, note: null });
  };
  const max = Math.max(0, ...(items ?? []).map(need));

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="font-mono text-muted">queue</span>
        <span className="ml-3 font-mono text-[10px] text-muted">source</span>
        <button className={cx(btn, source === "backend" && "border-accent text-accent")} onClick={() => switchSource("backend")} title={`${API_URL}/queue`}>
          backend
        </button>
        <button className={cx(btn, source === "fixtures" && "border-accent text-accent")} onClick={() => switchSource("fixtures")} title="fixtures/*.jsonl">
          fixtures
        </button>
        {note && (
          <span className="max-w-[34rem] truncate font-mono text-[10px] text-muted" title={note}>
            {note}
          </span>
        )}
        <span className="ml-auto flex gap-3 font-mono text-[11px] text-muted">
          <Link href="/benchmark" className="underline decoration-line hover:text-foreground">
            benchmark
          </Link>
          <Link href="/harness" className="underline decoration-line hover:text-foreground">
            harness
          </Link>
        </span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[1000px]">
          <div className="mb-2 font-mono text-[11px] text-muted">
            runs needing a human · sorted by unreviewed failed checks, then unresolved items, then lowest score
          </div>
          {items === null && !note && <div className="font-mono text-[11px] text-muted">loading…</div>}
          {items && items.length === 0 && <div className="font-mono text-[11px] text-muted">nothing needs a review</div>}
          {items && items.length > 0 && (
            <table className="w-full border-collapse text-[12px]" data-queue>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-wide text-muted uppercase">
                  <th className="py-1 pr-3 text-left font-normal">need</th>
                  <th className="py-1 pr-3 text-left font-normal">run</th>
                  <th className="py-1 pr-3 text-left font-normal">protocol</th>
                  <th className="py-1 pr-3 text-left font-normal">executor</th>
                  <th className="py-1 pr-3 text-left font-normal">harness</th>
                  <th className="py-1 pr-3 text-right font-normal">failed · unreviewed</th>
                  <th className="py-1 pr-3 text-right font-normal">unresolved</th>
                  <th className="py-1 text-right font-normal">structure_f1</th>
                </tr>
              </thead>
              <tbody>
                {items.map((q, i) => (
                  <tr
                    key={q.run_id}
                    data-queue-row={q.run_id}
                    data-rank={i + 1}
                    tabIndex={0}
                    role="link"
                    onClick={() => router.push(`/runs/${encodeURIComponent(q.run_id)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") router.push(`/runs/${encodeURIComponent(q.run_id)}`);
                    }}
                    className="cursor-pointer border-b border-line/60 hover:bg-panel focus:bg-panel focus:outline-none"
                    title={`open /runs/${q.run_id}`}
                  >
                    <td className="py-1.5 pr-3">
                      <NeedBar q={q} max={max} />
                    </td>
                    <td className="max-w-[16rem] truncate py-1.5 pr-3 font-mono text-[11px]">{q.run_id}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{q.protocol}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{q.executor}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{q.harness_version}</td>
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
