"use client";
// components/StatusBar.tsx — status · step · harness version · revision · tokens last/cumulative.
import Link from "next/link";
import type { UIState } from "@/lib/reducer";
import { fmtCompact, fmtInt } from "@/lib/format";
import { cx } from "@/lib/cx";

const DOT: Record<UIState["status"], string> = {
  idle: "bg-line",
  running: "bg-accent animate-pulse",
  paused: "bg-muted",
  reviewing: "bg-amber-500",
  done: "bg-emerald-500",
  failed: "bg-rose-500",
};

const shortVersion = (v: string) => (v.includes("/") ? v.slice(v.lastIndexOf("/") + 1) : v);

function Sep() {
  return <span className="text-line select-none">·</span>;
}

export function StatusBar({ ui }: { ui: UIState }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-panel px-3 font-mono text-[11px] tabular-nums text-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cx("inline-block h-1.5 w-1.5 rounded-full", DOT[ui.status])} />
        {ui.status}
      </span>
      {ui.step > 0 && (
        <>
          <Sep />
          <span>step {ui.step}</span>
        </>
      )}
      <Sep />
      <span title={ui.harnessVersion ?? undefined}>harness {shortVersion(ui.harnessVersion ?? "—")}</span>
      <Sep />
      <span>rev {ui.workflowRevision}</span>
      {ui.source && ui.source !== "live" && (
        <>
          <Sep />
          <span className="rounded-sm border border-line px-1 text-[10px] leading-[14px] text-muted" title="imported from a benchmark record; no agent trace or token counts">
            {ui.source} record{ui.executor ? ` · ${ui.executor}` : ""}
          </span>
        </>
      )}
      {(ui.tokens.lastCall > 0 || ui.tokens.cumulative > 0) && (
        <>
          <Sep />
          <span>{fmtInt(ui.tokens.lastCall)} tok/call</span>
          <Sep />
          <span>{fmtCompact(ui.tokens.cumulative)} total</span>
        </>
      )}
      <span className="ml-auto flex items-center gap-2 text-muted">
        {ui.harness.promoted && (
          <Link href="/harness" className="text-accent hover:underline" title="promoted by the gate during this run — open /harness">
            → {ui.harness.promoted} promoted
          </Link>
        )}
        {ui.protocolId && <span>{ui.protocolId}</span>}
        {ui.runId && (
          <span className="max-w-[16rem] truncate" title={ui.runId}>
            {ui.runId}
          </span>
        )}
      </span>
    </div>
  );
}
