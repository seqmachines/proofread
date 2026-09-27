// components/StrandGlyph.tsx — a thumbnail of a molecule's two strands as tiny
// §2.7-colored blocks. Ties trace rows back to the canvas identity.
import type { MoleculeState } from "@/lib/events";
import { segmentColor } from "@/lib/colors";

export function StrandGlyph({ state, size = 5 }: { state: MoleculeState; size?: number }) {
  const rows = [state.strands.top, state.strands.bottom];
  return (
    <span
      className="inline-flex shrink-0 flex-col gap-px align-middle"
      title={`${state.id}: ${state.strands.top.length} top / ${state.strands.bottom.length} bottom segments`}
    >
      {rows.map((segs, r) => (
        <span key={r} className="flex gap-px" style={{ height: size }}>
          {segs.length === 0 ? (
            <span style={{ width: (size + 2) * 2 + 1, height: size }} className="border-b border-dashed border-line" />
          ) : (
            segs.map((s, i) => (
              <span
                key={i}
                style={{ width: size + 2, height: size, background: segmentColor(s.type) }}
                className="rounded-[1px]"
              />
            ))
          )}
        </span>
      ))}
    </span>
  );
}
