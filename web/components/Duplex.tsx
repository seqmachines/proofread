// components/Duplex.tsx — a molecule's strands as named §2.7 blocks in one grid: one grid
// column per alignment column (lib/strandAlign.ts), each as wide as its longer name, so
// paired segments sit exactly over each other. Scrolls sideways rather than wrapping,
// because a wrapped row would lose the register.
import type { MoleculeState, Segment } from "@/lib/events";
import { segmentColor, segmentText } from "@/lib/colors";
import { alignStrands } from "@/lib/strandAlign";
import { cx } from "@/lib/cx";

const ROWS: { row: "top" | "bottom"; ends: [string, string] }[] = [
  { row: "top", ends: ["5′", "3′"] },
  { row: "bottom", ends: ["3′", "5′"] },
];

function Cell({ seg }: { seg: Segment | undefined }) {
  if (!seg) {
    return (
      <span className="flex h-4 min-w-3 items-center" title="no partner segment">
        <span className="block w-full border-t border-line" />
      </span>
    );
  }
  return (
    <span
      title={`${seg.name} · ${seg.type} · origin ${seg.origin}`}
      style={{ background: segmentColor(seg.type), color: segmentText(seg.type) }}
      className="h-4 rounded-[2px] px-1.5 text-center font-mono text-[10px] leading-4 font-medium whitespace-nowrap"
    >
      {seg.name}
    </span>
  );
}

export function Duplex({ state, className }: { state: Pick<MoleculeState, "strands" | "benchmark_structure">; className?: string }) {
  const columns = alignStrands(state);
  const rows = ROWS.filter(({ row }) => state.strands[row].length > 0);
  if (rows.length === 0) return <span className="font-mono text-[10px] text-muted">no segments</span>;
  return (
    <div className={cx("overflow-x-auto pb-0.5", className)} data-duplex>
      <div
        className="grid w-max items-center gap-x-[2px] gap-y-[3px] font-mono text-[10px] text-muted"
        style={{ gridTemplateColumns: `auto repeat(${columns.length}, max-content) auto` }}
      >
        {rows.map(({ row, ends }) => (
          // display: contents keeps both rows in the one grid, which is what aligns them
          <div key={row} className="contents" data-strand={row}>
            <span className="pr-1 select-none">{ends[0]}</span>
            {columns.map((c, k) => {
              const i = c[row];
              return <Cell key={k} seg={i === null ? undefined : state.strands[row][i]} />;
            })}
            <span className="pl-1 select-none">{ends[1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
