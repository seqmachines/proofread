// components/SegmentBlocks.tsx — one strand as named §2.7 blocks (full names, wrapping).
// `marks` + `tone` outline segments that a patch adds (emerald) or removes (rose).
import type { Segment } from "@/lib/events";
import { segmentColor, segmentText } from "@/lib/colors";
import { cx } from "@/lib/cx";

export function SegmentBlocks({ segments, marks, tone }: { segments: Segment[]; marks?: Set<number>; tone?: "added" | "removed" }) {
  if (segments.length === 0) {
    return <span className="inline-block h-4 w-16 border-b border-dashed border-line align-middle" title="single-stranded" />;
  }
  return (
    <span className="inline-flex flex-wrap gap-[2px] align-middle">
      {segments.map((s, i) => (
        <span
          key={i}
          title={`${s.name} · ${s.type} · origin ${s.origin}`}
          style={{ background: segmentColor(s.type), color: segmentText(s.type) }}
          className={cx(
            "h-4 rounded-[2px] px-1.5 font-mono text-[10px] leading-4 font-medium whitespace-nowrap",
            marks?.has(i) && tone === "added" && "ring-2 ring-emerald-500 ring-offset-1 ring-offset-panel",
            marks?.has(i) && tone === "removed" && "ring-2 ring-rose-500 ring-offset-1 ring-offset-panel line-through opacity-70",
          )}
        >
          {s.name}
        </span>
      ))}
    </span>
  );
}
