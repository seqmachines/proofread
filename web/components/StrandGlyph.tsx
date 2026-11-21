// components/StrandGlyph.tsx — a thumbnail of a molecule's two strands as tiny
// §2.7-colored blocks, in the same alignment columns as the canvas node
// (lib/strandAlign.ts). Ties trace rows back to the canvas identity.
import type { MoleculeState } from "@/lib/events";
import { segmentColor } from "@/lib/colors";
import { alignStrands } from "@/lib/strandAlign";

export function StrandGlyph({ state, size = 5 }: { state: MoleculeState; size?: number }) {
  const columns = alignStrands(state);
  const rows = ["top", "bottom"] as const;
  return (
    <span
      className="inline-flex shrink-0 flex-col gap-px align-middle"
      title={`${state.id}: ${state.strands.top.length} top / ${state.strands.bottom.length} bottom segments`}
    >
      {rows.map((row) => {
        const segs = state.strands[row];
        return (
          <span key={row} className="flex gap-px" style={{ height: size }}>
            {segs.length === 0 ? (
              <span style={{ width: (size + 2) * 2 + 1, height: size }} className="border-b border-dashed border-line" />
            ) : (
              columns.map((c, k) => {
                const i = c[row];
                return (
                  <span
                    key={k}
                    style={{ width: size + 2, height: size, background: i === null ? undefined : segmentColor(segs[i].type) }}
                    className="rounded-[1px]"
                  />
                );
              })
            )}
          </span>
        );
      })}
    </span>
  );
}
