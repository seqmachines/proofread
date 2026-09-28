"use client";
// lib/usePlayback.ts — a cursor over an ordered event list, advanced on a timer.
// UI state is fold(events.slice(0, cursor)); this hook owns only the cursor.
import { useCallback, useEffect, useState } from "react";

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Playback {
  cursor: number;
  total: number;
  playing: boolean;
  speed: Speed;
  play: () => void;
  toggle: () => void;
  step: (delta: number) => void;
  seek: (n: number) => void;
  restart: () => void;
  setSpeed: (s: Speed) => void;
}

export function usePlayback(
  total: number,
  { baseMs = 650, autoplay = false, openAtEnd = false }: { baseMs?: number; autoplay?: boolean; openAtEnd?: boolean } = {},
): Playback {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<Speed>(1);
  // openAtEnd: a finished run shows its final state at once instead of animating 1×;
  // replay/step/seek switch back to normal playback.
  const [jumping, setJumping] = useState(openAtEnd);
  const [armed, setArmed] = useState(openAtEnd);
  if (openAtEnd && !armed) {
    // the run's status arrives after mount; arm once, before any user interaction
    setArmed(true);
    setJumping(true);
  }

  useEffect(() => {
    if (!playing || total === 0 || cursor >= total) return;
    const id = setTimeout(() => setCursor((c) => (jumping ? total : Math.min(c + 1, total))), jumping ? 0 : baseMs / speed);
    return () => clearTimeout(id);
  }, [playing, cursor, total, speed, baseMs, jumping]);

  const seek = useCallback((n: number) => setCursor(Math.max(0, Math.min(total, n))), [total]);
  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setCursor((c) => Math.max(0, Math.min(total, c + delta)));
    },
    [total],
  );
  const play = useCallback(() => setPlaying(true), []);
  const restart = useCallback(() => {
    setCursor(0);
    setPlaying(true);
  }, []);
  const toggle = useCallback(() => {
    if (cursor >= total) {
      setCursor(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  }, [cursor, total]);

  return { cursor, total, playing, speed, play, toggle, step, seek, restart, setSpeed };
}
