"use client";
// lib/useRunEvents.ts — a live run's ordered event list from the backend.
// Validates the run first (404 → error, no reconnect loop), then subscribes.
import { useEffect, useState } from "react";
import type { Run, RunEvent } from "./events";
import { type ConnectionStatus, getRun, subscribe } from "./api";
import { toast } from "./toast";

export interface LiveRun {
  events: RunEvent[];
  run: Run | null;
  status: ConnectionStatus;
  detail: string | null;
  error: string | null;
}

/** `key` forces a fresh subscription (Replay: since=0 with `speed`, events reset). */
export function useRunEvents(runId: string | null, { speed = 1, key = 0 }: { speed?: number; key?: number } = {}): LiveRun {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let last: ConnectionStatus = "idle";
    getRun(runId)
      .then(({ run }) => {
        if (cancelled) return;
        setRun(run);
        setEvents([]);
        unsubscribe = subscribe(runId, {
          since: 0,
          speed,
          onEvent: (e) =>
            setEvents((prev) => (prev.length > 0 && e.seq <= prev[prev.length - 1].seq ? prev : [...prev, e])),
          onStatus: (s, d) => {
            setStatus(s);
            setDetail(d ?? null);
            if (s === "reconnecting" && (last === "live" || last === "connecting")) toast(`stream lost — ${d ?? "reconnecting"}`);
            if (s === "live" && last === "reconnecting") toast("stream reconnected", "info", 3000);
            if (s === "error" && last !== "error") toast(`stream: ${d ?? "error"}`);
            last = s;
          },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        toast(message);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [runId, speed, key]);

  return { events, run, status, detail, error };
}
