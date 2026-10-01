"use client";
// components/TransitionEdge.tsx — edge label "① reverse transcription" (commit order),
// dashed when the LLM built the transition (skill_call_id null). The transition's
// oligos render as small angled mini-molecules stacked beside the label, entering from
// the right (like the mRNA and TSO in the paper's Figure 1), named in words rather than
// by id. Nodes stack top → bottom, so the label sits at the edge midpoint in the gap. Synthetic substrate → discarded
// edges (data.discard) are dashed, faint, unlabeled.
import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { GRID_X, type TransitionEdge as TransitionEdgeType } from "@/lib/reducer";
import { guessSegmentType, segmentColor } from "@/lib/colors";
import { circled } from "@/lib/format";
import { cx } from "@/lib/cx";

// Transitions carry oligo ids ("oligo.cdna_amp.gex_forward"); until the backend sends a
// catalog with display names, show the id as words.
export const oligoName = (id: string) => id.replace(/^oligo\./, "").replace(/[._]+/g, " ");

function OligoMini({ id }: { id: string }) {
  const name = oligoName(id);
  const color = segmentColor(guessSegmentType(name));
  return (
    <span className="flex items-center gap-1.5" title={`oligo ${id}`} data-oligo={id}>
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-[2px]"
        style={{ width: 22, height: 5, background: color, transform: "rotate(-30deg)", transformOrigin: "left center", marginLeft: 2 }}
      />
      <span className="font-mono text-[9px] leading-3 whitespace-nowrap text-muted">{name}</span>
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
  const [path, midX, midY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const llm = data?.llm ?? true;
  const discard = Boolean(data?.discard);
  const op = data?.transition.op ?? "";
  const skill = data?.transition.skill_call_id;
  const oligos = data?.transition.oligos ?? [];
  // Where the label sits. A straight (same-column) edge: at the midpoint, just right of the
  // line, with the oligo stack. A cross-column edge: at 30% (going right) or 70% (going left)
  // of the way, on the outer side, with the oligos only in the tooltip — crossing PCR pairs
  // otherwise pile four identical primer stacks onto one spot.
  // Handles sit at each node's centre and nodes differ in width, so "same column" means
  // closer than half a column, not pixel-equal.
  const straight = Math.abs(targetX - sourceX) < GRID_X / 2;
  const t = straight ? 0.5 : sourceX < targetX ? 0.35 : 0.65;
  const labelX = straight ? midX : sourceX + (targetX - sourceX) * t;
  const labelY = straight ? midY : sourceY + (targetY - sourceY) * t;
  const showStack = straight && oligos.length > 0;
  const title = `${op}${llm ? " — constructed by the LLM (no skill call)" : ` — skill call ${skill}`}${oligos.length ? `\noligos: ${oligos.map(oligoName).join(", ")}` : ""}`;
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
        {straight ? (
          <div
            style={{ transform: `translate(8px, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="nodrag nopan pointer-events-auto absolute flex items-center gap-2"
            data-transition-label={data?.transition.id}
          >
            <span
              className={cx(
                "rounded-sm border bg-panel px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap",
                llm ? "border-dashed border-muted text-muted" : "border-line text-foreground",
                selected && "border-accent",
              )}
              title={title}
            >
              {data?.ordinal ? `${circled(data.ordinal)} ` : ""}
              {op.replace(/_/g, " ")}
            </span>
            {showStack && (
              // One oligo per line so four PCR primers do not run across the neighbouring column.
              <span className="flex flex-col gap-0.5 rounded-sm bg-background/80 px-1 py-0.5">
                {oligos.map((o) => (
                  <OligoMini key={o} id={o} />
                ))}
              </span>
            )}
          </div>
        ) : (
          // A cross-column edge gets only its number, in the gutter; op and oligos are in the
          // tooltip and in the trace. Two crossing edges sit at 35% and 65% so they never meet.
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cx(
              "nodrag nopan pointer-events-auto absolute rounded-full border bg-panel px-1 font-mono text-[10px] leading-4 whitespace-nowrap",
              llm ? "border-dashed border-muted text-muted" : "border-line text-foreground",
              selected && "border-accent",
            )}
            title={title}
            data-transition-label={data?.transition.id}
          >
            {data?.ordinal ? circled(data.ordinal) : op.replace(/_/g, " ")}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const TransitionEdge = memo(TransitionEdgeImpl);
