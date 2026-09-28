"use client";
// components/Workbench.tsx — the run page, laid out per SPEC.md §5.0:
// canvas ~65% | agent trace ~35%, with a fixed bottom strip (chat row + status bar).
// Source of events: the fixture for /runs/fixture (offline demo), otherwise the live
// backend stream (lib/api subscribe). Both feed fold(events[0:cursor]); the header
// keeps the replay controls. Node click → inspector drawer over the canvas's right edge.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { AppConfig, ErrorType, GtDiff, Protocol, ReviewDecision, ReviewInput, Reviewer, RunEvent } from "@/lib/events";
import { fold, type Patch } from "@/lib/reducer";
import { fixtureName, useFixtureEvents } from "@/lib/fixture";
import { useRunEvents } from "@/lib/useRunEvents";
import { ApiError, type ConnectionStatus, getConfig, getGtDiff, getHarness, getProtocols, isAuthError, postReview, sendMessage, startRun } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type ReviewerIdentity, getReviewer, isAuthor, setReviewer, useReviewer } from "@/lib/reviewer";
import { offlineApply, offlinePropose, offlineReview } from "@/lib/offlineEditor";
import { usePlayback } from "@/lib/usePlayback";
import { cx } from "@/lib/cx";
import { Playback } from "./Playback";
import { Trace } from "./Trace";
import { StatusBar } from "./StatusBar";
import { Inspector } from "./Inspector";
import { Chat } from "./Chat";
import { ReviewerPrompt } from "./ReviewerPrompt";

// Client-only: React Flow resolves colorMode="system" in the browser, so SSR would
// hydrate "light" against "dark" and warn. Nothing on the canvas is server-known anyway.
const Canvas = dynamic(() => import("./Canvas").then((m) => m.Canvas), { ssr: false });

const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40 disabled:hover:border-line";

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

function useConfig(): AppConfig | null {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((c) => {
        if (!cancelled) setCfg(c);
      })
      .catch(() => {
        /* unknown → assume an editor may exist */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return cfg;
}

function useActiveHarness(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getHarness()
      .then((h) => {
        if (!cancelled) setId(h._id);
      })
      .catch(() => {
        /* label falls back to "active" */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return id;
}

/** Asks for name + token on the first write (§6), keeps them in localStorage, and re-asks
 *  when the backend rejects the token. `withIdentity` runs a write with that guarantee. */
// An author's token is valid but scoped to one protocol: a 403 there is not a bad token, so
// don't re-prompt for identity — explain the scope instead.
const outOfScope = (e: unknown) => e instanceof ApiError && e.status === 403 && isAuthor(getReviewer());
const scopeError = () => new Error(`your invite covers ${getReviewer()?.protocol_id ?? "another protocol"} — this run is outside it, so the decision was refused`);

function useIdentity() {
  const reviewer = useReviewer();
  const [prompt, setPrompt] = useState<{ reason: string | null; resolve: (r: ReviewerIdentity | null) => void } | null>(null);
  const ask = (reason: string | null) =>
    new Promise<ReviewerIdentity | null>((resolve) => setPrompt({ reason, resolve }));
  const withIdentity = async <T,>(write: () => Promise<T>): Promise<T> => {
    if (!getReviewer()) {
      const r = await ask(null);
      if (!r) throw new Error("cancelled — no reviewer identity");
      setReviewer(r);
    }
    try {
      return await write();
    } catch (e) {
      if (!isAuthError(e)) throw e;
      if (outOfScope(e)) throw scopeError();
      const r = await ask("token rejected by the backend — check REVIEW_TOKENS");
      if (!r) throw e;
      setReviewer(r);
      return write();
    }
  };
  // Like withIdentity, but only asks after the backend says 401/403 (for routes that may not
  // exist at all — a 404 should not be preceded by an identity prompt).
  const retryOnAuth = async <T,>(write: () => Promise<T>): Promise<T> => {
    try {
      return await write();
    } catch (e) {
      if (!isAuthError(e)) throw e;
      if (outOfScope(e)) throw scopeError();
      const r = await ask(getReviewer() ? "token rejected by the backend — check REVIEW_TOKENS" : null);
      if (!r) throw e;
      setReviewer(r);
      return write();
    }
  };
  const asReviewer = (): Reviewer => ({ id: reviewer?.name ?? "curator", name: reviewer?.name ?? "curator", role: reviewer?.role ?? "curator" });
  const modal = prompt ? (
    <ReviewerPrompt
      initial={getReviewer()}
      reason={prompt.reason}
      onSave={(r) => {
        prompt.resolve(r);
        setPrompt(null);
      }}
      onCancel={() => {
        prompt.resolve(null);
        setPrompt(null);
      }}
    />
  ) : null;
  return { reviewer, withIdentity, retryOnAuth, asReviewer, modal };
}

export function Workbench({ runId }: { runId: string }) {
  const router = useRouter();
  const identity = useIdentity();
  const fixtureKey = fixtureName(runId); // "" | "<name>" | null (live)
  const isFixture = fixtureKey !== null;
  const fixture = useFixtureEvents(fixtureKey);
  // Replay: live runs resubscribe from seq 0 with speed=8 (server-paced), fixtures restart.
  const [replayKey, setReplayKey] = useState(0);
  const live = useRunEvents(isFixture ? null : runId, { speed: replayKey > 0 ? 8 : 1, key: replayKey });
  // Events the local editor appends (fixtures always; live runs when the server has no editor).
  const [extra, setExtra] = useState<RunEvent[]>([]);
  const events = useMemo(() => [...(isFixture ? fixture.events : live.events), ...extra], [isFixture, fixture.events, live.events, extra]);
  const error = isFixture ? fixture.error : live.error;
  const protocols = useProtocols();

  // A run that is already finished opens complete; running and fixture runs animate.
  const finishedOnLoad = !isFixture && (live.run?.status === "done" || live.run?.status === "failed");
  const pb = usePlayback(events.length, { autoplay: true, openAtEnd: finishedOnLoad });
  const ui = useMemo(() => fold(events.slice(0, pb.cursor)), [events, pb.cursor]);
  const full = useMemo(() => fold(events), [events]); // complete state, for the offline editor and reviews
  const current = pb.cursor > 0 ? events[pb.cursor - 1] : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? ui.nodes.find((n) => n.id === selectedId) : undefined;

  const onSend = async (text: string): Promise<string | void> => {
    if (isFixture) {
      setExtra((x) => [...x, ...offlinePropose(full, text, full.lastSeq + 1, pendingModify?.target)]);
      pb.play();
      return;
    }
    try {
      const res = await identity.retryOnAuth(() => sendMessage(runId, text));
      if (res.queued) return "queued — the agent drains messages at its next step";
    } catch (e) {
      // No editor on this backend (404/501): draft the patch locally; applying it still records
      // the modify review on the server, which does the repair.
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
        setExtra((x) => [...x, ...offlinePropose(full, text, full.lastSeq + 1, pendingModify?.target)]);
        pb.play();
        return "no editor on this backend — the patch below was drafted locally; apply records the review";
      }
      throw e;
    }
  };
  // Applying a patch card = a `modify` review (§5 step 1 repairs, step 2 signals). The
  // reviewer chooses the §2.4 error category; the reviewer identity comes from the token.
  const onApply = async (patch: Patch, systematic: boolean, errorType: ErrorType) => {
    const target = full.nodes.find((n) => n.id === patch.target)?.data.state;
    const review: ReviewInput = {
      run_id: full.runId ?? runId,
      workflow_revision: full.workflowRevision,
      target_id: patch.target,
      decision: "modify",
      before: patch.before ?? target ?? {},
      after: patch.after,
      error_type: errorType,
      note: patch.reason,
      systematic,
    };
    if (isFixture) {
      // review_recorded first, then the repair as the backend would emit it (state_revised + patch_applied).
      const seq = full.lastSeq + 1;
      const { events: recorded, review_id } = offlineReview(full, { ...review, after: undefined }, identity.asReviewer(), seq);
      const modified = patch.after ? { ...patch, after: { ...patch.after, review_status: "modified" as const } } : patch;
      const applied = offlineApply(full, modified, seq + recorded.length).map((e) => (e.t === "state_revised" ? { ...e, caused_by: review_id } : e));
      setExtra((x) => [...x, ...recorded, ...applied]);
      pb.play();
      setPendingModify(null);
      return;
    }
    const res = await identity.withIdentity(() => postReview(runId, review));
    setPendingModify(null);
    toast(`review ${res.review_id} recorded · rev ${res.workflow_revision}${res.derived?.signal_id ? ` · signal ${res.derived.signal_id}` : ""}`, "info", 4000);
  };

  // Inspector decisions other than modify. error_type: required for reject, null otherwise.
  const onReview = async (decision: Exclude<ReviewDecision, "modify">, note: string, systematic: boolean, errorType: ErrorType | null) => {
    if (!selected) return;
    const review: ReviewInput = {
      run_id: full.runId ?? runId,
      workflow_revision: full.workflowRevision,
      target_id: selected.id,
      decision,
      before: selected.data.state,
      after: decision === "reject" ? null : undefined,
      error_type: decision === "reject" ? errorType : null,
      note,
      systematic,
    };
    if (isFixture) {
      const { events: evs } = offlineReview(full, review, identity.asReviewer(), full.lastSeq + 1);
      setExtra((x) => [...x, ...evs]);
      pb.play();
      if (decision === "reject") setSelectedId(null);
      return;
    }
    const res = await identity.withIdentity(() => postReview(runId, review));
    toast(`review ${res.review_id} recorded${res.derived?.signal_id ? ` · signal ${res.derived.signal_id}` : ""}`, "info", 4000);
    if (decision === "reject") setSelectedId(null);
  };

  // The backend names the reviewer's role on review_recorded; keep the stored identity in sync.
  const lastRole = full.reviews.length ? full.reviews[full.reviews.length - 1].reviewer.role : null;
  useEffect(() => {
    const r = getReviewer();
    if (r && lastRole && r.role !== lastRole && full.reviews[full.reviews.length - 1].reviewer.name === r.name) setReviewer({ ...r, role: lastRole });
  }, [lastRole, full.reviews]);

  // modify → remember the chosen category, seed the chat with the target and note; the
  // patch card's apply records the review.
  const [chatText, setChatText] = useState("");
  const [chatFocus, setChatFocus] = useState(0);
  const [pendingModify, setPendingModify] = useState<{ target: string; error_type: ErrorType } | null>(null);
  const onModify = (note: string, errorType: ErrorType) => {
    if (!selected) return;
    setPendingModify({ target: selected.id, error_type: errorType });
    setChatText(note ? `modify ${selected.id}: ${note}` : `modify ${selected.id}: `);
    setChatFocus((k) => k + 1);
  };
  // No chat editor (EXECUTOR=none): the inspector's composer drafts the patch locally.
  const onDraft = (sentence: string, errorType: ErrorType) => {
    if (!selected) return;
    setPendingModify({ target: selected.id, error_type: errorType });
    setExtra((x) => [...x, ...offlinePropose(full, sentence, full.lastSeq + 1, selected.id)]);
    pb.play();
  };

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
  const activeHarness = useActiveHarness();
  const config = useConfig();
  const noEditor = config?.executor === "none";
  const author = isAuthor(identity.reviewer);
  const scopeNotice =
    author && identity.reviewer?.protocol_id && ui.protocolId && identity.reviewer.protocol_id !== ui.protocolId
      ? `your invite covers ${identity.reviewer.protocol_id}; decisions on this ${ui.protocolId} run will be refused`
      : null;

  // After run_finished: run again on the active harness, and compare with ground truth.
  const finished = ui.status === "done" || ui.status === "failed";
  const [starting, setStarting] = useState(false);
  const runAgain = async () => {
    if (!ui.protocolId || starting) return;
    setStarting(true);
    try {
      const { run_id } = await startRun(ui.protocolId, { executor: "codex" });
      router.push(`/runs/${encodeURIComponent(run_id)}`);
    } catch (e) {
      toast(`run again failed: ${e instanceof Error ? e.message : String(e)}`);
      setStarting(false);
    }
  };
  const [gtDiff, setGtDiff] = useState<GtDiff | null>(null);
  const [comparing, setComparing] = useState(false);
  const compareGt = async () => {
    if (gtDiff) {
      setGtDiff(null);
      return;
    }
    setComparing(true);
    try {
      setGtDiff(await getGtDiff(runId));
    } catch (e) {
      toast(`gt-diff: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setComparing(false);
    }
  };
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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="max-w-[7rem] truncate font-mono text-muted" title={runId}>
          {runId}
        </span>
        <span className={cx("font-mono text-[11px]", conn.cls)} title={live.detail ?? undefined}>
          {conn.text}
          {live.detail && live.status === "reconnecting" ? ` ${live.detail}` : ""}
        </span>
        <Link href="/queue" className="ml-3 font-mono text-[11px] text-muted underline decoration-line hover:text-foreground">
          queue
        </Link>
        {!author && (
          <Link href="/harness" className="font-mono text-[11px] text-muted underline decoration-line hover:text-foreground">
            harness
          </Link>
        )}
        <Link href="/benchmark" className="font-mono text-[11px] text-muted underline decoration-line hover:text-foreground">
          benchmark
        </Link>
        {identity.reviewer && (
          <button
            className="max-w-[9rem] truncate font-mono text-[11px] text-muted hover:text-foreground"
            title={`reviewing as ${identity.reviewer.name} · click to change name or token`}
            onClick={() => setReviewer(null)}
            data-reviewer={identity.reviewer.name}
            data-role={identity.reviewer.role ?? ""}
          >
            · {identity.reviewer.name}
            {identity.reviewer.role === "author" ? " (author)" : ""}
          </button>
        )}
        {finished && protocol && (
          <span className="ml-3 flex items-center gap-1.5" data-after-run>
            {!scopeNotice && (
              <button className={btn} onClick={() => void runAgain()} disabled={starting} title={`POST /runs {protocol_id: ${ui.protocolId}}`}>
                {starting ? "starting…" : `run again on ${activeHarness ?? "active harness"}`}
              </button>
            )}
            {hasGt && !isFixture && (
              <button
                className={cx(btn, gtDiff && "border-amber-500 text-amber-600 dark:text-amber-400")}
                onClick={() => void compareGt()}
                disabled={comparing}
                title="GET /runs/{id}/gt-diff — highlights states the ground truth does not have"
              >
                {comparing
                  ? "comparing…"
                  : gtDiff
                    ? gtDiff.matched_states
                      ? `GT: ${gtDiff.matched_states.length} matched · ${diffIds(gtDiff.missing_states).length} GT-only · ${diffIds(gtDiff.extra_states).length} predicted-only ✕`
                      : `GT: ${diffIds(gtDiff.missing_states).length} missing · ${diffIds(gtDiff.extra_states).length} extra ✕`
                    : "compare with ground truth"}
              </button>
            )}
          </span>
        )}
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
              runId={isFixture ? null : runId}
              hasGt={hasGt}
              gtDiff={gtDiff}
              onReview={onReview}
              onModify={onModify}
              onDraft={noEditor ? onDraft : undefined}
              scopeNotice={scopeNotice}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
        <Trace ui={ui} className="w-[35%] min-w-[320px] shrink-0 border-l border-line" />
      </div>

      <div className="shrink-0">
        <Chat
          ui={ui}
          offline={isFixture}
          text={chatText}
          onText={setChatText}
          focusKey={chatFocus}
          onSend={onSend}
          onApply={onApply}
          pendingErrorType={pendingModify}
          showInput={!noEditor || isFixture}
        />
        <StatusBar ui={ui} />
      </div>
      {identity.modal}
    </div>
  );
}
