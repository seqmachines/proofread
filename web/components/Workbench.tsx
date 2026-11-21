"use client";
// components/Workbench.tsx — the run page, read-only: canvas ~65% | agent trace ~35%.
// Source of events: the fixture for /runs/fixture (offline demo), otherwise the live
// backend stream (lib/api subscribe). Both feed fold(events[0:cursor]); the header
// carries the run status and the replay controls. Node click → inspector drawer over
// the canvas's right edge.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { GtDiff, Protocol } from "@/lib/events";
import { fold, type UIState } from "@/lib/reducer";
import { fixtureName, useFixtureEvents } from "@/lib/fixture";
import { useRunEvents } from "@/lib/useRunEvents";
import { type ConnectionStatus, getGtDiff, getProtocols } from "@/lib/api";
import { usePlayback } from "@/lib/usePlayback";
import { cx } from "@/lib/cx";
import { Playback } from "./Playback";
import { Trace } from "./Trace";
import { Inspector } from "./Inspector";
import { ScoreBox } from "./ScoreBox";

// Client-only: React Flow resolves colorMode="system" in the browser, so SSR would
// hydrate "light" against "dark" and warn. Nothing on the canvas is server-known anyway.
const Canvas = dynamic(() => import("./Canvas").then((m) => m.Canvas), { ssr: false });

const diffIds = (list: unknown[] | undefined) =>
  (list ?? []).flatMap((x) => (typeof x === "string" ? [x] : typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string" ? [(x as { id: string }).id] : []));

// Edge entries look like {type, from, to}; both ends may name a state.
const edgeEnds = (list: unknown[] | undefined) =>
  (list ?? []).flatMap((x) => {
    if (typeof x !== "object" || x === null) return [];
    const e = x as { from?: unknown; to?: unknown; source?: unknown; target?: unknown };
    return [e.from, e.to, e.source, e.target].filter((v): v is string => typeof v === "string");
  });

const CONN: Record<ConnectionStatus, { text: string; cls: string }> = {
  idle: { text: "—", cls: "text-muted" },
  connecting: { text: "connecting…", cls: "text-muted" },
  live: { text: "● connected", cls: "text-emerald-600 dark:text-emerald-400" },
  reconnecting: { text: "○ reconnecting…", cls: "text-amber-600 dark:text-amber-400" },
  polling: { text: "● polling", cls: "text-muted" },
  closed: { text: "closed", cls: "text-muted" },
  error: { text: "● offline", cls: "text-rose-600 dark:text-rose-400" },
};

const STATUS_DOT: Record<UIState["status"], string> = {
  idle: "bg-line",
  running: "bg-accent animate-pulse",
  paused: "bg-muted",
  reviewing: "bg-amber-500",
  done: "bg-emerald-500",
  failed: "bg-rose-500",
};

function useProtocols(): Protocol[] | null {
  const [protocols, setProtocols] = useState<Protocol[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProtocols()
      .then((p) => {
        if (!cancelled) setProtocols(p);
      })
      .catch(() => {
        /* backend offline: has_gt stays unknown */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return protocols;
}

export function Workbench({ runId, label }: { runId: string; label?: string }) {
  const fixtureKey = fixtureName(runId); // "" | "<name>" | null (live)
  const isFixture = fixtureKey !== null;
  const fixture = useFixtureEvents(fixtureKey);
  // Replay: live runs resubscribe from seq 0 with speed=8 (server-paced), fixtures restart.
  const [replayKey, setReplayKey] = useState(0);
  const live = useRunEvents(isFixture ? null : runId, { speed: replayKey > 0 ? 8 : 1, key: replayKey });
  const events = isFixture ? fixture.events : live.events;
  const error = isFixture ? fixture.error : live.error;
  const protocols = useProtocols();

  // A run that is already finished opens complete; running and fixture runs animate.
  const finishedOnLoad = !isFixture && (live.run?.status === "done" || live.run?.status === "failed");
  const pb = usePlayback(events.length, { autoplay: true, openAtEnd: finishedOnLoad });
  const ui = useMemo(() => fold(events.slice(0, pb.cursor)), [events, pb.cursor]);
  const current = pb.cursor > 0 ? events[pb.cursor - 1] : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? ui.nodes.find((n) => n.id === selectedId) : undefined;

  const { restart, setSpeed } = pb;
  const replay = useCallback(() => {
    if (!isFixture) setReplayKey((k) => k + 1);
    setSpeed(8);
    restart();
  }, [isFixture, restart, setSpeed]);

  // Keyboard: r = replay, esc = close the inspector (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        replay();
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay]);
  const protocol = protocols?.find((p) => p.id === ui.protocolId);
  const hasGt = protocols === null ? null : (protocol?.has_gt ?? false);
  const conn = isFixture ? { text: "offline replay", cls: "text-muted" } : CONN[live.status];

  // After run_finished the ground-truth diff loads by itself (§2.6): matched states carry
  // their similarity, predicted states without a counterpart get the amber ring.
  const finished = ui.status === "done" || ui.status === "failed";
  const [gtDiff, setGtDiff] = useState<GtDiff | null>(null);
  const [gtError, setGtError] = useState(false);
  useEffect(() => {
    if (!finished || !hasGt || isFixture || gtDiff) return;
    let cancelled = false;
    getGtDiff(runId)
      .then((d) => {
        if (!cancelled) setGtDiff(d);
      })
      .catch(() => { if (!cancelled) setGtError(true); });
    return () => {
      cancelled = true;
    };
  }, [finished, hasGt, isFixture, runId, gtDiff]);
  // Canonical diff: predicted states with no GT counterpart get the amber ring; matched
  // states carry their similarity. (Legacy diffs without matched_states fall back to edges.)
  const mismatch = useMemo(() => {
    if (!gtDiff) return null;
    const ids = new Set(ui.nodes.map((n) => n.id));
    const extra = diffIds(gtDiff.extra_states);
    const legacy = gtDiff.matched_states ? [] : edgeEnds(gtDiff.extra_edges);
    return new Set([...extra, ...legacy].filter((id) => ids.has(id)));
  }, [gtDiff, ui.nodes]);
  const similarity = useMemo(() => {
    if (!gtDiff?.matched_states) return null;
    return new Map(gtDiff.matched_states.filter((m) => m.predicted?.id).map((m) => [m.predicted.id, m.similarity]));
  }, [gtDiff]);

  return (
    // Fixed to the viewport: the run page never scrolls as a document (panels scroll inside),
    // so a trackpad swipe over the canvas or trace cannot push the whole page up.
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="max-w-[28rem] truncate font-mono text-muted" title={label ?? ui.protocolId ?? "run"}>
          {label ?? ui.protocolId ?? "run"}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums" data-run-status={ui.status}>
          <span className={cx("inline-block h-1.5 w-1.5 rounded-full", STATUS_DOT[ui.status])} />
          {ui.status}
          <span className="text-muted" title="workflow revision">
            · rev {ui.workflowRevision}
          </span>
        </span>
        <span className={cx("font-mono text-[11px]", conn.cls)} title={live.detail ?? undefined}>
          {conn.text}
          {live.detail && live.status === "reconnecting" ? ` ${live.detail}` : ""}
        </span>
        {/* queue, memory and harness stay reachable by URL; only benchmark is linked (2026-09-28 UI pass) */}
        <Link href="/benchmark" className="ml-3 font-mono text-[11px] text-muted underline decoration-line hover:text-foreground">
          benchmark
        </Link>
        <div className="ml-auto">
          <Playback pb={pb} current={current} onReplay={replay} />
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-600/40 bg-rose-600/10 px-3 py-1 font-mono text-[11px] text-rose-600 dark:text-rose-400">
          {error}
          {!isFixture && (
            <>
              {" · "}
              <Link href="/runs/fixture" className="underline">
                open the offline fixture
              </Link>
            </>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <Canvas
            nodes={ui.nodes}
            edges={ui.edges}
            selectedId={selected ? selectedId : null}
            mismatch={mismatch}
            similarity={similarity}
            tick={ui.lastSeq}
            onNodeClick={(n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
          />
          {ui.benchmarkScore && (
            <ScoreBox score={ui.benchmarkScore} gt={ui.gtScore} executor={ui.executor} harness={ui.harnessVersion} className="absolute bottom-10 left-2 z-[4]" />
          )}
          {ui.nodes.length === 0 && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-empty>
              <span className="rounded border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-muted">
                {events.length === 0
                  ? isFixture
                    ? "loading fixture…"
                    : live.status === "error"
                      ? "stream offline"
                      : "connecting to the run…"
                  : ui.status === "done" || ui.status === "failed"
                    ? "this run committed no states"
                    : `no states yet — ${ui.trace.at(-1)?.goal ?? "the agent is reading the protocol"}`}
              </span>
            </div>
          )}
          {selected && (
            <Inspector
              key={selected.id}
              node={selected}
              ui={ui}
              hasGt={hasGt}
              gtDiff={gtDiff}
              gtUnavailable={gtError}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
        <Trace ui={ui} diff={finished ? gtDiff : null} comparisonUnavailable={finished && gtError}
          className="w-[35%] min-w-[320px] shrink-0 border-l border-line" />
      </div>
    </div>
  );
}
