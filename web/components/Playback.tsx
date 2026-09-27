"use client";
// components/Playback.tsx — step through events on a timer. Becomes "Replay" in F6.
import type { RunEvent } from "@/lib/events";
import { eventSummary } from "@/lib/format";
import { SPEEDS, type Playback as PlaybackState, type Speed } from "@/lib/usePlayback";
import { cx } from "@/lib/cx";

const btn =
  "h-6 min-w-6 rounded border border-line bg-panel px-1.5 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40 disabled:hover:border-line";

export function Playback({ pb, current, onReplay }: { pb: PlaybackState; current?: RunEvent; onReplay: () => void }) {
  const atEnd = pb.total > 0 && pb.cursor >= pb.total;
  const running = pb.playing && !atEnd;
  const summary = current ? `#${current.seq} ${eventSummary(current)}` : "—";
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
      <span className="hidden max-w-[18rem] truncate text-muted 2xl:inline" title={summary}>
        {summary}
      </span>
      <button className={cx(btn, "border-accent text-accent")} onClick={onReplay} title="Replay from the start at 8× — live runs reconnect with speed=8 (r)" aria-label="Replay">
        ⟲ replay
      </button>
      <button className={btn} onClick={() => pb.step(-1)} disabled={pb.cursor === 0} title="Step back" aria-label="Step back">
        ‹
      </button>
      <button className={cx(btn, "min-w-8")} onClick={pb.toggle} title={running ? "Pause" : "Play"} aria-label={running ? "Pause" : "Play"}>
        {running ? "❚❚" : "▶"}
      </button>
      <button className={btn} onClick={() => pb.step(1)} disabled={atEnd || pb.total === 0} title="Step forward" aria-label="Step forward">
        ›
      </button>
      <input
        type="range"
        min={0}
        max={pb.total}
        value={pb.cursor}
        onChange={(e) => pb.seek(Number(e.target.value))}
        className="mx-1 h-1 w-32 cursor-pointer accent-accent"
        aria-label="Scrub"
      />
      <span className="w-12 text-right text-muted">
        {pb.cursor}/{pb.total}
      </span>
      <select
        value={pb.speed}
        onChange={(e) => pb.setSpeed(Number(e.target.value) as Speed)}
        className="h-6 rounded border border-line bg-panel px-1 text-[11px] text-foreground"
        aria-label="Speed"
        title="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}
