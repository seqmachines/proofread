"use client";
// components/ScoreBox.tsx — the agent's performance on this run (the saved Task 3 benchmark
// metrics for the library-generation workflow) under the executor · harness that produced it,
// pinned to the canvas' lower left. Numbers only; the names are the benchmark's own, spelled out.
import type { BenchmarkScore, GtScore } from "@/lib/events";
import { cx } from "@/lib/cx";

const shortVersion = (v: string) => (v.includes("/") ? v.slice(v.lastIndexOf("/") + 1) : v);

const T3: [string, string][] = [
  ["t3_state_f1", "states"],
  ["t3_molecular_transition_f1", "transitions"],
  ["t3_typed_edge_f1", "typed edges"],
];

const tone = (v: number) => (v >= 0.8 ? "text-emerald-600 dark:text-emerald-400" : v >= 0.5 ? "text-foreground" : "text-rose-600 dark:text-rose-400");

export function ScoreBox({
  score,
  gt,
  executor,
  harness,
  className,
}: {
  score: BenchmarkScore;
  gt?: GtScore | null;
  executor?: string | null; // run_started.executor, e.g. codex
  harness?: string | null; // run_started.harness_version, e.g. libgen-gpt-5-6-sol
  className?: string;
}) {
  const rows = T3.filter(([k]) => typeof score.metrics[k] === "number").map(([k, label]) => [k, label, score.metrics[k]] as const);
  if (rows.length === 0) return null;
  return (
    <div
      className={cx("pointer-events-auto rounded border border-line bg-panel/95 px-2.5 py-1.5 font-mono text-[10px] leading-4", className)}
      title={`benchmark ${score.benchmark_version} · ${Object.entries(score.metrics)
        .map(([k, v]) => `${k} ${v.toFixed(3)}`)
        .join(" · ")}`}
      data-score-box
    >
      <div className="mb-0.5 text-[10px] text-foreground" title="executor · harness version that produced this run">
        {[executor, harness ? shortVersion(harness) : null].filter(Boolean).join(" · ") || "agent performance"}
      </div>
      <table className="border-separate border-spacing-x-2 border-spacing-y-0">
        <tbody>
          {rows.map(([k, label, v]) => (
            <tr key={k}>
              <td className="pl-0 text-muted">{label} F1</td>
              <td className={cx("text-right tabular-nums", tone(v))}>{v.toFixed(2)}</td>
            </tr>
          ))}
          {gt && (
            <tr title="proofread's own comparison with the ground truth">
              <td className="pl-0 text-muted">vs GT structure</td>
              <td className={cx("text-right tabular-nums", tone(gt.structure_f1))}>{gt.structure_f1.toFixed(2)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
