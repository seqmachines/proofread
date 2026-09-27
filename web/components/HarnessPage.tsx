"use client";
// components/HarnessPage.tsx — /harness: versions newest first; click one → patches as
// from → to rows, eval table (target / regression deltas, decision, reason), config.
// Source: the backend (GET /harness/versions), or the synthetic loop fixture when the
// backend is unreachable or has no candidates yet (toggle in the header).
import { useEffect, useState } from "react";
import Link from "next/link";
import type { GateProtocolResult, HarnessPatch, HarnessVersion } from "@/lib/events";
import { API_URL, getHarnessVersions } from "@/lib/api";
import { FIXTURE_LOOP_RUN_ID, loadFixtureEvents } from "@/lib/fixture";
import { versionsFromEvents } from "@/lib/harness";
import { fmtDelta, fmtTime, fmtVal } from "@/lib/format";
import { cx } from "@/lib/cx";

type Source = "backend" | "fixture";

const STATUS: Record<HarnessVersion["status"], string> = {
  active: "border-accent/60 text-accent",
  candidate: "border-amber-500/60 text-amber-600 dark:text-amber-400",
  promoted: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
  rejected: "border-rose-500/60 text-rose-600 dark:text-rose-400",
  superseded: "border-line text-muted",
};

const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40";

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("inline-block rounded-sm border px-1 font-mono text-[10px] leading-[14px] whitespace-nowrap", className ?? "border-line text-muted")}>{children}</span>;
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 font-mono text-[9px] tracking-widest text-muted uppercase">{children}</h3>;
}

function PatchRows({ patches }: { patches: HarnessPatch[] }) {
  if (patches.length === 0) return <div className="text-[11px] text-muted">no patches — base version</div>;
  return (
    <table className="w-full text-[11px] leading-4">
      <tbody>
        {patches.map((p, i) => (
          <tr key={i} className="border-t border-line/60 align-top first:border-t-0">
            <td className="py-1 pr-2 whitespace-nowrap">
              <Chip>{p.type}</Chip> {p.scope && <Chip>{p.scope}</Chip>}
            </td>
            <td className="py-1 pr-2 font-mono">{p.path}</td>
            <td className="py-1 pr-2 font-mono">
              <span className="text-muted">{fmtVal(p.from)}</span> → {fmtVal(p.to)}
            </td>
            <td className="py-1 text-muted">{p.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EvalTable({ ev }: { ev: NonNullable<HarnessVersion["eval"]> }) {
  const rows: GateProtocolResult[] = [ev.target, ...(ev.regression ?? [])].filter(Boolean);
  const pass = ev.decision === "promote";
  return (
    <div>
      <table className="w-full font-mono text-[11px] leading-4 tabular-nums">
        <thead>
          <tr className="text-[9px] tracking-wide text-muted uppercase">
            <th className="pr-2 text-left font-normal">role</th>
            <th className="pr-2 text-left font-normal">protocol</th>
            <th className="pr-2 text-right font-normal">before</th>
            <th className="pr-2 text-right font-normal">after</th>
            <th className="text-right font-normal">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line/60">
              <td className="py-0.5 pr-2 text-muted">{r.role ?? "?"}</td>
              <td className="py-0.5 pr-2">{r.protocol_id ?? fmtVal(r)}</td>
              <td className="py-0.5 pr-2 text-right text-muted">{typeof r.before === "number" ? r.before.toFixed(2) : "—"}</td>
              <td className="py-0.5 pr-2 text-right">{typeof r.after === "number" ? r.after.toFixed(2) : "—"}</td>
              <td className={cx("py-0.5 text-right", r.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : r.delta < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted")}>
                {typeof r.delta === "number" ? fmtDelta(r.delta) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1.5 text-[11px]">
        <span className={cx("font-mono font-semibold", pass ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{pass ? "PASS" : "REJECT"}</span>{" "}
        <span className="text-muted">— {ev.reason}</span>
      </div>
    </div>
  );
}

function Detail({ v }: { v: HarnessVersion }) {
  return (
    <div className="flex flex-col gap-3 p-3 text-[12px]" data-version={v._id}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[14px] font-semibold">{v._id}</span>
        {v.parent_id && (
          <span className="font-mono text-muted">
            ← {v.parent_id}
          </span>
        )}
        <Chip className={STATUS[v.status]}>{v.status}</Chip>
        <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">{fmtTime(v.created_at)}</span>
      </div>
      <section>
        <H>patches · {v.patches.length}</H>
        <PatchRows patches={v.patches} />
      </section>
      <section>
        <H>eval</H>
        {v.eval ? <EvalTable ev={v.eval} /> : <div className="text-[11px] text-muted">{v.status === "candidate" ? "not gated yet" : "no gate run for this version"}</div>}
      </section>
      <section>
        <H>configuration</H>
        <table className="w-full font-mono text-[11px] leading-4">
          <tbody>
            {Object.entries(v.tool_access ?? {}).map(([k, val]) => (
              <tr key={k} className="border-t border-line/60 first:border-t-0">
                <td className="py-0.5 pr-2 text-muted">tool_access.{k}</td>
                <td className={cx("py-0.5", val === "mandatory" && "text-accent", val === "off" && "text-muted")}>{val}</td>
              </tr>
            ))}
            <tr className="border-t border-line/60">
              <td className="py-0.5 pr-2 text-muted">guardrails</td>
              <td className="py-0.5">{(v.guardrails ?? []).join(", ") || "—"}</td>
            </tr>
            {Object.entries(v.context_policy ?? {}).map(([k, val]) => (
              <tr key={k} className="border-t border-line/60">
                <td className="py-0.5 pr-2 text-muted">context_policy.{k}</td>
                <td className="py-0.5">{fmtVal(val)}</td>
              </tr>
            ))}
            <tr className="border-t border-line/60 align-top">
              <td className="py-0.5 pr-2 text-muted">rules</td>
              <td className="py-0.5">{(v.rules ?? []).length ? (v.rules ?? []).map((r, i) => <div key={i}>{r}</div>) : "—"}</td>
            </tr>
            <tr className="border-t border-line/60">
              <td className="py-0.5 pr-2 text-muted">source_signals</td>
              <td className="py-0.5">{(v.source_signals ?? []).join(", ") || "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function HarnessPage({ initialSource }: { initialSource?: Source }) {
  const [state, setState] = useState<{ source: Source; versions: HarnessVersion[] | null; note: string | null }>({
    source: initialSource ?? "backend",
    versions: null,
    note: null,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const { source, versions, note } = state;

  // Loads whenever the source changes; state is only set from the async callbacks.
  useEffect(() => {
    let cancelled = false;
    const load = source === "backend" ? getHarnessVersions() : loadFixtureEvents("loop").then(versionsFromEvents);
    load
      .then((vs) => {
        if (cancelled) return;
        setState((st) => ({ ...st, versions: vs }));
        setSelected((sel) => (sel && vs.some((v) => v._id === sel) ? sel : (vs[0]?._id ?? null)));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        if (source === "backend") setState({ source: "fixture", versions: null, note: `backend unreachable (${message}) — showing the fixture` });
        else setState((st) => ({ ...st, versions: [], note: message }));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const switchSource = (next: Source) => {
    if (next === source) return;
    setSelected(null); // reselect the newest version of the new source
    setState({ source: next, versions: null, note: null });
  };

  const current = versions?.find((v) => v._id === selected) ?? null;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="font-mono text-muted">harness</span>
        <span className="ml-3 font-mono text-[10px] text-muted">source</span>
        <button className={cx(btn, source === "backend" && "border-accent text-accent")} onClick={() => switchSource("backend")} title={API_URL}>
          backend
        </button>
        <button className={cx(btn, source === "fixture" && "border-accent text-accent")} onClick={() => switchSource("fixture")} title="fixtures/run_example_loop.jsonl">
          fixture-loop
        </button>
        {note && (
          <span className="max-w-[30rem] truncate font-mono text-[10px] text-muted" title={note}>
            {note}
          </span>
        )}
        <span className="ml-auto flex gap-3 font-mono text-[11px] text-muted">
          <Link href="/queue" className="underline decoration-line hover:text-foreground">
            queue
          </Link>
          <Link href="/memory" className="underline decoration-line hover:text-foreground">
            memory
          </Link>
          <Link href="/benchmark" className="underline decoration-line hover:text-foreground">
            benchmark
          </Link>
          <Link href={`/runs/${FIXTURE_LOOP_RUN_ID}`} className="underline decoration-line hover:text-foreground">
            replay the loop →
          </Link>
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-line bg-panel">
          {versions === null && <div className="p-3 font-mono text-[11px] text-muted">loading…</div>}
          {versions?.length === 0 && <div className="p-3 font-mono text-[11px] text-muted">no versions</div>}
          <ul>
            {versions?.map((v) => (
              <li key={v._id}>
                <button
                  onClick={() => setSelected(v._id)}
                  className={cx(
                    "flex w-full flex-col gap-0.5 border-b border-line px-3 py-2 text-left hover:bg-background",
                    selected === v._id && "bg-background",
                  )}
                  data-version-row={v._id}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-semibold">{v._id}</span>
                    {v.parent_id && <span className="font-mono text-[10px] text-muted">← {v.parent_id}</span>}
                    <Chip className={cx("ml-auto", STATUS[v.status])}>{v.status}</Chip>
                  </span>
                  <span className="font-mono text-[10px] text-muted tabular-nums">
                    {v.patches.length} patch{v.patches.length === 1 ? "" : "es"}
                    {v.eval ? ` · gate ${v.eval.decision}` : ""} · {fmtTime(v.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          {current ? <Detail v={current} /> : <div className="p-3 font-mono text-[11px] text-muted">select a version</div>}
        </main>
      </div>
    </div>
  );
}
