"use client";
// components/MoleculeNode.tsx — one molecule state, drawn after the paper's Figure 1:
// the full name on top, then each strand as a thin continuous bar of §2.7-colored
// segment blocks with 5′/3′ ends (top 5′ left, bottom 3′ left; bottom[i] sits under
// top[i]). Block widths follow the segment's (estimated) length — lib/segmentLength.ts.
// A segment present on one strand only is an overhang: bar on that strand, hairline
// where the partner would be. The box is transparent so the strands are the figure.
// Ghost (skill result not yet committed): dashed border. Stale or discarded: 40%
// opacity. Badges only when they say something: review decision, failed checks,
// findings, ground-truth similarity. Amber ring: no ground-truth counterpart.
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Segment } from "@/lib/events";
import type { MoleculeNode as MoleculeNodeType } from "@/lib/reducer";
import { segmentColor, segmentText } from "@/lib/colors";
import { estimateLength, strandWidths } from "@/lib/segmentLength";
import { cx } from "@/lib/cx";

const END_W = 14; // 5′/3′ label column
const BAR_H = 14;
const CHAR_W = 5.4; // 9px Geist Mono, approx
const PAD_X = 10;
export const NODE_MIN_W = 200;
export const NODE_MAX_W = 320;

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
      title={`${seg.name} · ${seg.type} · ~${estimateLength(seg)} nt`}
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

function Bar({ segs, widths, ends }: { segs: Segment[]; widths: number[]; ends: [string, string] }) {
  const barW = widths.reduce((s, w) => s + w, 0);
  return (
    <div className="flex items-center" style={{ height: BAR_H }}>
      <span className="font-mono text-[9px] leading-none text-muted select-none" style={{ width: END_W }}>
        {ends[0]}
      </span>
      <span className="flex overflow-hidden rounded-[2px]" style={{ width: barW, height: BAR_H }}>
        {widths.map((w, i) => {
          const seg = segs[i];
          return seg ? (
            <Block key={i} seg={seg} width={w} last={i === widths.length - 1} />
          ) : (
            <span key={i} className="flex items-center" style={{ width: w, height: BAR_H }} title="overhang — no partner segment">
              <span className="block w-full border-t border-line" />
            </span>
          );
        })}
      </span>
      <span className="pl-1 text-right font-mono text-[9px] leading-none text-muted select-none" style={{ width: END_W }}>
        {ends[1]}
      </span>
    </div>
  );
}

function MoleculeNodeImpl({ data, selected }: NodeProps<MoleculeNodeType>) {
  const { state, ghost, stale, discarded, failed, gtMismatch, gtSimilarity } = data;
  const { top, bottom } = state.strands;
  const widths = strandWidths(top, bottom, NODE_MAX_W - 2 * PAD_X - 2 * END_W - 4);
  const barW = widths.reduce((s, w) => s + w, 0) + 2 * END_W + 4;
  const width = Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, barW + 2 * PAD_X));
  const review = state.review_status;
  const extraStrands = Math.max(0, (state.benchmark_structure?.strands.length ?? 0) - 2);
  const badges = review !== "unreviewed" || data.findings > 0 || typeof gtSimilarity === "number" || failed > 0 || ghost || discarded || extraStrands > 0;

  return (
    <div
      style={{ width }}
      className={cx(
        "rounded-md border bg-transparent px-2.5 py-1.5 text-foreground",
        ghost ? "border-dashed border-muted" : "border-line/80",
        (stale || discarded) && "opacity-40",
        selected && "ring-2 ring-accent",
        gtMismatch && !selected && "ring-2 ring-amber-500",
      )}
      data-mismatch={gtMismatch ? "true" : undefined}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-line" />
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-line" />

      <div className="mb-1 text-[11px] leading-[14px] font-semibold break-words" title={state.id} data-label>
        {state.label}
      </div>

      <div className="flex flex-col gap-[3px]">
        {top.length > 0 && <Bar segs={top} widths={widths} ends={["5′", "3′"]} />}
        {bottom.length > 0 && <Bar segs={bottom} widths={widths} ends={["3′", "5′"]} />}
      </div>

      {badges && (
        <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[8px] leading-3 text-muted">
          {ghost && <span>proposed</span>}
          {discarded && <span title="product not carried forward">discarded</span>}
          {extraStrands > 0 && (
            <span className="text-amber-600 dark:text-amber-400" title="preview of the reference strand and one partner">
              +{extraStrands} more strand{extraStrands > 1 ? "s" : ""}
            </span>
          )}
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
            <span className="ml-auto shrink-0 rounded-sm bg-rose-600 px-1 font-semibold text-white" title={`${failed} failed verifier check${failed > 1 ? "s" : ""}`}>
              ✗ {failed}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const MoleculeNode = memo(MoleculeNodeImpl);
