"use client";
// components/TransitionEdge.tsx — edge label "① reverse transcription" (commit order),
// dashed when the LLM built the transition (skill_call_id null). The transition's
// oligos render as small angled mini-molecules beside the label, entering from the
// right (like the mRNA and TSO in the paper's Figure 1). Nodes stack top → bottom, so
// the label sits at the edge midpoint in the gap. Synthetic substrate → discarded
// edges (data.discard) are dashed, faint, unlabeled.
import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { TransitionEdge as TransitionEdgeType } from "@/lib/reducer";
import { guessSegmentType, segmentColor } from "@/lib/colors";
import { circled } from "@/lib/format";
import { cx } from "@/lib/cx";

function OligoMini({ name }: { name: string }) {
  const color = segmentColor(guessSegmentType(name));
  return (
    <span className="inline-flex items-center gap-1" title={`oligo: ${name}`} data-oligo={name}>
      <span
        aria-hidden
        className="inline-block rounded-[2px]"
        style={{ width: 22, height: 5, background: color, transform: "rotate(-30deg)", transformOrigin: "left center", marginLeft: 2 }}
      />
      <span className="max-w-[9rem] truncate font-mono text-[9px] text-muted">{name}</span>
    </span>
  );
}

function TransitionEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<TransitionEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const llm = data?.llm ?? true;
  const discard = Boolean(data?.discard);
  const op = data?.transition.op ?? "";
  const skill = data?.transition.skill_call_id;
  const oligos = data?.transition.oligos ?? [];
  if (discard) {
    return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ strokeWidth: 1.25, strokeDasharray: "4 4", opacity: 0.5 }} />;
  }
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ strokeWidth: selected ? 2 : 1.5, strokeDasharray: llm ? "5 4" : undefined }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-2"
        >
          <span
            className={cx(
              "rounded-sm border bg-panel px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap",
              llm ? "border-dashed border-muted text-muted" : "border-line text-foreground",
              selected && "border-accent",
            )}
            title={llm ? `${op} — constructed by the LLM (no skill call)` : `${op} — skill call ${skill}`}
          >
            {data?.ordinal ? `${circled(data.ordinal)} ` : ""}
            {op.replace(/_/g, " ")}
          </span>
          {oligos.length > 0 && (
            <span className="flex items-center gap-2 rounded-sm bg-panel/80 px-1">
              {oligos.map((o) => (
                <OligoMini key={o} name={o} />
              ))}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const TransitionEdge = memo(TransitionEdgeImpl);
