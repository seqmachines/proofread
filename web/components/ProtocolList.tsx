"use client";
// components/ProtocolList.tsx — the start page's protocol list (SPEC.md §6): per protocol,
// one button per system with a result (executor · model · harness, from `sources`), each
// opening that run; "run live" only when /config reports live_runs.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Protocol, ProtocolSource } from "@/lib/events";
import { startRun } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cx } from "@/lib/cx";

const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40 disabled:hover:border-line";

const ROLE: Record<Protocol["role"], string> = {
  dev: "text-accent border-accent/50",
  regression: "text-muted border-line",
  transfer: "text-amber-600 border-amber-500/50 dark:text-amber-400",
};

const SOURCE: Record<string, string> = {
  live: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  harbor: "border-accent/50 text-accent",
  benchmark: "border-line text-muted",
  fixture: "border-line text-muted",
};

// The backend's first importer stored source file paths in `sources`; §2.6 now defines
// run objects. Render only entries that name a run, so either shape is safe.
const isSource = (x: unknown): x is ProtocolSource =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as { run_id?: unknown }).run_id === "string";

const shortVersion = (v: string) => (v.includes("/") ? v.slice(v.lastIndexOf("/") + 1) : v);

/** The headline saved metric for a benchmark record, labeled as what it is. */
function benchmarkHeadline(
  s: ProtocolSource,
): { label: string; value: number } | null {
  const m = s.benchmark_score?.metrics;
  if (!m) return null;
  const key = "t3_state_f1" in m ? "t3_state_f1" : Object.keys(m)[0];
  return key && typeof m[key] === "number"
    ? { label: key, value: m[key] }
    : null;
}

function SourceButton({ s }: { s: ProtocolSource }) {
  const head = benchmarkHeadline(s);
  return (
    <Link
      href={`/runs/${encodeURIComponent(s.run_id)}`}
      className={cx(btn, "inline-flex items-center gap-1.5 no-underline")}
      title={`open /runs/${s.run_id} · harness ${s.harness_version}${head ? ` · ${head.label} ${head.value.toFixed(2)} (benchmark record)` : ""}`}
      data-source-run={s.run_id}
    >
      <span
        className={cx(
          "rounded-sm border px-1 text-[9px] leading-[13px]",
          SOURCE[s.source] ?? SOURCE.benchmark,
        )}
      >
        {s.source}
      </span>
      <span>
        {s.executor}
        {s.model && s.model !== "—" ? ` · ${s.model}` : ""} ·{" "}
        {shortVersion(s.harness_version)}
      </span>
      {head && (
        <span
          className="text-muted tabular-nums"
          title={`${head.label} — saved benchmark metric, not structure_f1`}
        >
          {head.value.toFixed(2)}
        </span>
      )}
      <span className="text-muted">→</span>
    </Link>
  );
}

export interface ProtocolListProps {
  protocols: Protocol[] | null;
  liveRuns: boolean; // /config.live_runs — hides "run live" when false or unknown
  activeHarness: string | null;
  error?: string | null;
}

export function ProtocolList({
  protocols,
  liveRuns,
  activeHarness,
  error,
}: ProtocolListProps) {
  const router = useRouter();
  const [starting, setStarting] = useState<string | null>(null);

  const runLive = async (protocol_id: string) => {
    setStarting(protocol_id);
    try {
      const { run_id } = await startRun(protocol_id);
      router.push(`/runs/${encodeURIComponent(run_id)}`);
    } catch (e: unknown) {
      toast(`run live failed: ${e instanceof Error ? e.message : String(e)}`);
      setStarting(null);
    }
  };

  return (
    <div>
      {error && (
        <div
          className="mb-2 rounded border border-line bg-panel px-2 py-1 font-mono text-[11px] text-muted"
          title={error}
        >
          {error}
        </div>
      )}
      {protocols === null && !error && (
        <div className="font-mono text-[11px] text-muted">
          loading protocols…
        </div>
      )}
      {protocols && (
        <table className="w-full border-collapse text-[12px]" data-protocols>
          <thead>
            <tr className="border-b border-line font-mono text-[10px] tracking-wide text-muted uppercase">
              <th className="py-1 pr-3 text-left font-normal">protocol</th>
              <th className="py-1 pr-3 text-left font-normal">family</th>
              <th className="py-1 pr-3 text-left font-normal">role</th>
              <th className="py-1 pr-3 text-left font-normal">gt</th>
              <th className="py-1 text-left font-normal">
                systems with a result → open the run
              </th>
            </tr>
          </thead>
          <tbody>
            {protocols.map((p) => {
              const sources = (p.sources ?? []).filter(isSource);
              return (
                <tr
                  key={p.id}
                  className="border-b border-line/60 align-top"
                  data-protocol={p.id}
                >
                  <td className="py-1.5 pr-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-[10px] text-muted">
                      {p.id}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">
                    {p.family}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      className={cx(
                        "rounded-sm border px-1 font-mono text-[10px] leading-[14px]",
                        ROLE[p.role] ?? ROLE.regression,
                      )}
                    >
                      {p.role}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-[11px]">
                    {p.has_gt ? (
                      <span
                        className="rounded-sm border border-emerald-500/50 px-1 text-[10px] leading-[14px] text-emerald-600 dark:text-emerald-400"
                        title="ground truth available"
                      >
                        GT
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {sources.map((s) => (
                        <SourceButton key={s.run_id} s={s} />
                      ))}
                      {sources.length === 0 && (
                        <span className="font-mono text-[11px] text-muted">
                          no results yet
                        </span>
                      )}
                      {liveRuns && (
                        <button
                          className={cx(
                            btn,
                            "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
                          )}
                          disabled={starting !== null}
                          onClick={() => void runLive(p.id)}
                          title={`POST /runs {protocol_id: ${p.id}} on ${activeHarness ?? "the active harness"}`}
                          data-run-live={p.id}
                        >
                          {starting === p.id
                            ? "starting…"
                            : `run live · ${activeHarness ?? "active"}`}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {protocols.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-2 font-mono text-[11px] text-muted"
                >
                  {
                    "no protocols — import benchmark records (python -m backend.import_benchmark) or seed a folder"
                  }
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
