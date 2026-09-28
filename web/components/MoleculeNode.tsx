"use client";
// components/MoleculeNode.tsx — one molecule state, drawn after the paper's Figure 1:
// each strand is a thin continuous bar of §2.7-colored segment blocks with 5′/3′ ends
// (top 5′ left, bottom 3′ left; bottom[i] sits under top[i]). A segment present on
// one strand only is an overhang: bar on that strand, hairline where the partner
// would be. Single-stranded states draw one bar. The state label sits bold to the
// right. Ghost (skill result not yet committed): dashed border. Stale or discarded:
// 40% opacity. Red badge: failed verifier checks; "N findings": model proposals;
// review badge: the human decision (accepted / modified / rejected / unresolved).
// Amber ring: GT mismatch.
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Segment } from "@/lib/events";
import type { MoleculeNode as MoleculeNodeType } from "@/lib/reducer";
import { segmentColor, segmentText } from "@/lib/colors";
import { cx } from "@/lib/cx";

export const NODE_WIDTH = 276;
const END_W = 12; // 5′/3′ label column
const BAR_W = 140; // the bar itself
const BAR_H = 14;
const CHAR_W = 5.4; // 9px Geist Mono, approx

// §2.1 review_status, set only by human reviews (review_recorded).
const REVIEW_BADGE: Record<string, string> = {
  accepted: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
  modified: "border-accent/60 text-accent",
  rejected: "border-rose-500/60 text-rose-600 dark:text-rose-400",
  unresolved: "border-amber-500/60 text-amber-600 dark:text-amber-400",
};

function Block({ seg, width, last }: { seg: Segment; width: number; last: boolean }) {
  const showName = seg.name.length * CHAR_W + 4 <= width;
  return (
    <span
      title={`${seg.name} · ${seg.type} · origin ${seg.origin}`}
      style={{
        width,
        height: BAR_H,
        background: segmentColor(seg.type),
        color: segmentText(seg.type),
        boxShadow: last ? undefined : "inset -1px 0 0 rgba(255,255,255,0.45)",
      }}
      className="block shrink-0 overflow-hidden text-center font-mono text-[9px] leading-[14px] font-medium whitespace-nowrap"
    >
      {showName ? seg.name : ""}
    </span>
  );
}

function Bar({ segs, cols, ends, dim }: { segs: Segment[]; cols: number; ends: [string, string]; dim?: boolean }) {
  const cell = BAR_W / cols;
  return (
    <div className={cx("flex items-center", dim && "opacity-60")} style={{ height: BAR_H }}>
      <span className="font-mono text-[9px] leading-none text-muted select-none" style={{ width: END_W }}>
        {ends[0]}
      </span>
      <span className="flex overflow-hidden rounded-[2px]" style={{ width: BAR_W, height: BAR_H }}>
        {Array.from({ length: cols }, (_, i) => {
          const seg = segs[i];
          return seg ? (
            <Block key={i} seg={seg} width={cell} last={i === cols - 1} />
          ) : (
            <span key={i} className="flex items-center" style={{ width: cell, height: BAR_H }} title="overhang — no partner segment">
              <span className="block w-full border-t border-line" />
            </span>
          );
        })}
      </span>
      <span className="text-right font-mono text-[9px] leading-none text-muted select-none" style={{ width: END_W }}>
        {ends[1]}
      </span>
    </div>
  );
}

function MoleculeNodeImpl({ data, selected }: NodeProps<MoleculeNodeType>) {
  const { state, ghost, stale, discarded, failed, gtMismatch, gtSimilarity } = data;
  const { top, bottom } = state.strands;
  const cols = Math.max(top.length, bottom.length, 1);
  const single = bottom.length === 0 || top.length === 0;
  const review = state.review_status;
  const extraStrands = Math.max(0, (state.benchmark_structure?.strands.length ?? 0) - 2);

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={cx(
        "rounded-md border bg-panel px-2 py-1.5 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
        ghost ? "border-dashed border-muted" : "border-line",
        (stale || discarded) && "opacity-40",
        selected && "ring-2 ring-accent",
        gtMismatch && !selected && "ring-2 ring-amber-500",
      )}
      data-mismatch={gtMismatch ? "true" : undefined}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-line" />
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-line" />

      <div className="flex items-start gap-2">
        {/* strands */}
        <div className="flex shrink-0 flex-col gap-[3px] pt-0.5">
          {top.length > 0 && <Bar segs={top} cols={cols} ends={["5′", "3′"]} />}
          {bottom.length > 0 && <Bar segs={bottom} cols={cols} ends={["3′", "5′"]} />}
          {single && !extraStrands && (
            <div className="font-mono text-[8px] leading-none text-muted" style={{ paddingLeft: END_W }}>
              single-stranded
            </div>
          )}
          {extraStrands > 0 && (
            <div className="font-mono text-[8px] leading-none text-amber-600 dark:text-amber-400" style={{ paddingLeft: END_W }} title="preview of the reference strand and one partner; open the inspector for the full benchmark structure">
              +{extraStrands} more strand{extraStrands > 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* label */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <span className="shrink-0 font-mono text-[9px] text-muted">{state.id}</span>
            {ghost && <span className="ml-auto shrink-0 font-mono text-[9px] text-muted">proposed</span>}
            {discarded && (
              <span className="ml-auto shrink-0 font-mono text-[9px] text-muted" title="product not carried forward">
                discarded
              </span>
            )}
          </div>
          <div className="line-clamp-2 text-[11px] leading-[13px] font-semibold" title={state.label}>
            {state.label}
          </div>
          <div className="mt-0.5 flex items-center gap-1 font-mono text-[8px] leading-3 text-muted">
            <span className="rounded-sm border border-line px-1 uppercase tracking-wide" title={`origin: ${state.origin}`}>
              {state.origin}
            </span>
            <span className="truncate" title={state.evidence.length ? `evidence: ${state.evidence.join(", ")}` : "no evidence"}>
              {state.evidence.length ? `${state.evidence.length} ev` : "—"}
            </span>
            {review !== "unreviewed" && (
              <span className={cx("rounded-sm border px-1", REVIEW_BADGE[review])} title={`review: ${review}`} data-review={review}>
                {review}
              </span>
            )}
            {data.findings > 0 && (
              <span className="rounded-sm border border-rose-500/60 px-1 text-rose-600 dark:text-rose-400" title={`${data.findings} model finding${data.findings > 1 ? "s" : ""} (proposal)`}>
                {data.findings} finding{data.findings > 1 ? "s" : ""}
              </span>
            )}
            {typeof gtSimilarity === "number" && (
              <span
                className={cx("rounded-sm border px-1 tabular-nums", gtSimilarity >= 0.8 ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-400" : "border-amber-500/60 text-amber-600 dark:text-amber-400")}
                title={`matched a ground-truth state with similarity ${gtSimilarity.toFixed(2)}`}
                data-gt-similarity={gtSimilarity.toFixed(2)}
              >
                GT {gtSimilarity.toFixed(2)}
              </span>
            )}
            {failed > 0 && (
              <span
                className="ml-auto shrink-0 rounded-sm bg-rose-600 px-1 font-semibold text-white"
                title={`${failed} failed verifier check${failed > 1 ? "s" : ""} on ${state.id}`}
              >
                ✗ {failed}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const MoleculeNode = memo(MoleculeNodeImpl);
