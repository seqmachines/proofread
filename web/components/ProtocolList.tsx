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

function SourceButton({ s, showHarness }: { s: ProtocolSource; showHarness: boolean }) {
  const head = benchmarkHeadline(s);
  const imported = s.source === "benchmark" || s.source === "fixture";
  return (
    <Link
      href={`/runs/${encodeURIComponent(s.run_id)}`}
      className={cx(btn, "inline-flex items-center gap-1.5 no-underline")}
      title={`open /runs/${s.run_id} · ${s.source} · harness ${s.harness_version}${head ? ` · ${head.label} ${head.value.toFixed(2)} (benchmark record)` : ""}`}
      data-source-run={s.run_id}
    >
      {!imported && (
        <span className={cx("rounded-sm border px-1 text-[9px] leading-[13px]", SOURCE[s.source] ?? SOURCE.benchmark)}>{s.source}</span>
      )}
      <span>
        {s.executor}
        {s.model && s.model !== "—" ? ` · ${s.model}` : ""}
        {showHarness ? <span className="text-muted"> · {shortVersion(s.harness_version)}</span> : null}
      </span>
      {head && (
        <span className="text-muted tabular-nums" title={`${head.label} — saved benchmark metric, not structure_f1`}>
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
              <th className="py-1 text-left font-normal">result</th>
            </tr>
          </thead>
          <tbody>
            {protocols.map((p) => {
              const sources = (p.sources ?? []).filter(isSource);
              // executor · model is the label; the harness version only matters when a
              // protocol has results from more than one (it always stays in the tooltip).
              const harnesses = new Set(sources.map((s) => s.harness_version));
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
                      {/* family comes from the import metadata; the benchmark importer has none */}
                      {p.family && p.family !== "unclassified" ? ` · ${p.family}` : ""}
                    </div>
                  </td>
                  <td className="py-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {sources.map((s) => (
                        <SourceButton key={s.run_id} s={s} showHarness={harnesses.size > 1} />
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
                  colSpan={2}
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
