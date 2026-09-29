"use client";
// components/Trace.tsx — "Agent trace": one card per step_started with the goal
// line, then one row per event under that step (checkpoints are hidden — the
// status bar consumes them). Last 15 steps, auto-scroll unless pinned. Rows carry
// data-kind={t}; evidence chips show two per row, then "+N" expands inline.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { EvidenceHit, RunEvent } from "@/lib/events";
import type { HarnessUI, HarnessVersionUI, TraceStep, UIState } from "@/lib/reducer";
import { eventSummary, fmtDelta, fmtTime, fmtVal, shortChunk } from "@/lib/format";
import { cx } from "@/lib/cx";
import { StrandGlyph } from "./StrandGlyph";

const MAX_STEPS = 15;

// ---------------------------------------------------------------- small parts

function Chip({ children, title, tone }: { children: React.ReactNode; title?: string; tone?: "muted" | "accent" | "rose" }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-block rounded-sm border px-1 font-mono text-[10px] leading-[14px] whitespace-nowrap",
        tone === "accent" && "border-accent/50 text-accent",
        tone === "rose" && "border-rose-500/50 text-rose-600 dark:text-rose-400",
        (!tone || tone === "muted") && "border-line text-muted",
      )}
    >
      {children}
    </span>
  );
}

const CHIP_LIMIT = 2;

// The first `limit` chips, then a "+N" chip that expands the rest inline.
function ChipList<T>({ items, keyOf, render, limit = CHIP_LIMIT }: { items: T[]; keyOf: (t: T) => string; render: (t: T) => React.ReactNode; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const shown = open ? items : items.slice(0, limit);
  const rest = items.length - shown.length;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {shown.map((it) => (
        <span key={keyOf(it)}>{render(it)}</span>
      ))}
      {rest > 0 && (
        <button
          onClick={() => setOpen(true)}
          className="inline-block rounded-sm border border-line px-1 font-mono text-[10px] leading-[14px] text-muted hover:border-accent hover:text-foreground"
          title={`show ${rest} more`}
          data-more={rest}
        >
          +{rest}
        </button>
      )}
      {open && items.length > limit && (
        <button onClick={() => setOpen(false)} className="inline-block px-0.5 font-mono text-[10px] leading-[14px] text-muted hover:text-foreground" title="collapse">
          −
        </button>
      )}
    </span>
  );
}

function ChunkChips({ hits, protocolId }: { hits: EvidenceHit[]; protocolId: string | null }) {
  return (
    <ChipList
      items={hits}
      keyOf={(h) => h.chunk_id}
      render={(hit) => (
        <Chip title={`${hit.chunk_id} · page ${hit.page}\n${hit.snippet}`}>
          {shortChunk(hit.chunk_id, protocolId)} <span className="opacity-60">p{hit.page}</span>
        </Chip>
      )}
    />
  );
}

function Chips({ ids, protocolId = null }: { ids: string[]; protocolId?: string | null }) {
  return (
    <ChipList
      items={ids}
      keyOf={(id) => id}
      render={(id) => (
        <Chip title={id}>{shortChunk(id, protocolId)}</Chip>
      )}
    />
  );
}

type Tone = "default" | "muted" | "ok" | "fail" | "warn" | "accent" | "rose";

const TONE: Record<Tone, string> = {
  default: "text-foreground",
  muted: "text-muted",
  ok: "text-emerald-600 dark:text-emerald-400",
  fail: "text-rose-600 dark:text-rose-400",
  warn: "text-amber-600 dark:text-amber-400",
  accent: "text-accent",
  rose: "text-rose-600 dark:text-rose-400",
};

function Row({ e, label, tone = "default", children }: { e: RunEvent; label: string; tone?: Tone; children: React.ReactNode }) {
  return (
    <li data-kind={e.t} data-seq={e.seq} className="flex gap-2" title={`#${e.seq} ${e.t} · ${fmtTime(e.ts)}`}>
      <span className={cx("w-12 shrink-0 font-mono text-[10px] leading-4 uppercase", tone === "default" ? "text-muted" : TONE[tone])}>
        {label}
      </span>
      <div className={cx("min-w-0 flex-1 text-[11px] leading-4 break-words", tone === "muted" && "text-muted")}>{children}</div>
    </li>
  );
}

// ---------------------------------------------------------------- one row per event type

function EventRow({ e, protocolId }: { e: RunEvent; protocolId: string | null }) {
  switch (e.t) {
    case "evidence_searched":
      return (
        <Row e={e} label="search">
          <span className="text-muted">“{e.query}”</span> <ChunkChips hits={e.results} protocolId={protocolId} />
          {e.results.length === 0 && <Chip>no hits</Chip>}
        </Row>
      );
    case "skill_called":
      return (
        <Row e={e} label="skill" tone={e.error ? "fail" : "default"}>
          <span className="font-mono">
            {e.skill}({e.inputs.substrate_id}, {e.inputs.oligo})
          </span>{" "}
          {e.result ? (
            <>
              → <span className="font-mono">{e.result.id}</span> {e.result.label} <StrandGlyph state={e.result} />{" "}
              <Chip>{e.skill_call_id}</Chip>
            </>
          ) : (
            <span className={TONE.fail}>✗ {e.error ?? "no result"}</span>
          )}
        </Row>
      );
    case "state_committed":
      return (
        <Row e={e} label="commit">
          <span className="font-mono">{e.state.id}</span> {e.state.label} <StrandGlyph state={e.state} />{" "}
          <Chip>{e.state.origin}</Chip> {e.state.skill_call_id && <Chip>{e.state.skill_call_id}</Chip>}{" "}
          <Chips ids={e.state.evidence} protocolId={protocolId} /> <span className="text-muted">rev {e.workflow_revision}</span>
        </Row>
      );
    case "transition_committed":
      return (
        <Row e={e} label="edge">
          <span className="font-mono">
            {e.transition.from} → {e.transition.to}
          </span>{" "}
          {e.transition.op}{" "}
          {e.transition.skill_call_id ? <Chip>{e.transition.skill_call_id}</Chip> : <Chip title="constructed by the LLM, no skill call">llm</Chip>}{" "}
          <Chips ids={e.transition.evidence} protocolId={protocolId} />
          {!!e.transition.discarded?.length && (
            <>
              {" "}
              <span className="text-muted">discards</span> <Chips ids={e.transition.discarded} />
            </>
          )}
        </Row>
      );
    case "state_revised":
      return (
        <Row e={e} label={e.after ? "revise" : "remove"} tone="warn">
          <span className="font-mono">{e.state_id}</span> <StrandGlyph state={e.before} /> →{" "}
          {e.after ? <StrandGlyph state={e.after} /> : <span className="text-muted">removed</span>}{" "}
          <span className="text-muted">caused by {e.caused_by} · rev {e.workflow_revision}</span>
          {e.stale.length > 0 && (
            <>
              {" "}
              <span className="text-muted">stale:</span> <Chips ids={e.stale} />
            </>
          )}
        </Row>
      );
    case "transition_revised":
      return (
        <Row e={e} label={e.after === null ? "remove" : e.before === null ? "add" : "revise"} tone="warn">
          <span className="font-mono">{e.transition_id}</span>{" "}
          {e.after ? (
            <>
              <span className="font-mono">
                {e.after.from} → {e.after.to}
              </span>{" "}
              {e.after.op}
            </>
          ) : (
            <span className="text-muted">transition removed</span>
          )}{" "}
          <span className="text-muted">caused by {e.caused_by} · rev {e.workflow_revision}</span>
        </Row>
      );
    case "review_recorded":
      return (
        <Row e={e} label="review" tone={e.decision === "reject" ? "fail" : e.decision === "accept" ? "ok" : e.decision === "modify" ? "accent" : "warn"}>
          <Chip tone={e.decision === "reject" ? "rose" : e.decision === "accept" ? "muted" : "accent"}>{e.decision}</Chip>{" "}
          <span className="font-mono">{e.target_id}</span> <span className="text-muted">by {e.reviewer.name ?? e.reviewer.id} ({e.reviewer.role})</span>{" "}
          <Chip>{e.review_id}</Chip>
          {e.note && <div className="text-muted">{e.note}</div>}
        </Row>
      );
    case "assumption":
      return (
        <Row e={e} label="assume" tone="muted">
          <span className="italic">{e.text}</span> {e.state_id && <Chip>{e.state_id}</Chip>}
        </Row>
      );
    case "guardrail_blocked":
      return (
        <Row e={e} label="block" tone="warn">
          <span className="font-mono">{e.tool}</span> <span className="text-muted">— {e.reason}</span>
        </Row>
      );
    case "checkpoint":
      return null; // the status bar shows tokens; checkpoints would only add noise here
    case "verifier_check": {
      const ok = e.status === "pass";
      return (
        <Row e={e} label="check" tone={ok ? "ok" : "fail"}>
          <span className={TONE[ok ? "ok" : "fail"]}>{ok ? "✓" : "✗"}</span> <span className="font-mono" title={e.check}>{e.check.replace(/_/g, " ")}</span>{" "}
          {e.state_id && <Chip tone={ok ? "muted" : "rose"}>{e.state_id}</Chip>} <span className="text-muted">— {e.message}</span>{" "}
          {e.evidence && <Chips ids={e.evidence} protocolId={protocolId} />}
        </Row>
      );
    }
    case "gt_scored":
      return (
        <Row e={e} label="gt" tone="muted">
          <span className="tabular-nums">
            structure_f1 {e.structure_f1.toFixed(2)} · edge_f1 {e.edge_f1.toFixed(2)}
          </span>
        </Row>
      );
    case "benchmark_scored":
      return (
        <Row e={e} label="bench" tone="muted">
          <span className="tabular-nums">
            {e.benchmark_version} ·{" "}
            {Object.entries(e.metrics)
              .map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(2) : String(v)}`)
              .join(" · ")}
          </span>{" "}
          <Chip title="saved benchmark metrics under their original names; not proofread's structure_f1">benchmark record</Chip>
        </Row>
      );
    case "review_finding":
      return (
        <Row e={e} label="review" tone="rose">
          <div className="rounded-sm border-l-2 border-rose-500/70 pl-2">
            <div>
              <Chip tone="rose">{e.signal_id}</Chip> {e.state_id && <Chip tone="rose">{e.state_id}</Chip>} <Chip>{e.operation}</Chip>{" "}
              <Chip tone={e.harness_relevance === "high" ? "accent" : "muted"}>relevance {e.harness_relevance}</Chip>
            </div>
            <div className="mt-0.5">{e.finding}</div>
            <div className="mt-0.5 font-mono text-[10px] text-muted">
              {e.root_cause} → {e.recommended_action}
            </div>
          </div>
        </Row>
      );
    case "human_message":
      return (
        <Row e={e} label="human">
          {e.text} <Chip>{e.mode}</Chip>
        </Row>
      );
    case "patch_proposed":
      return (
        <Row e={e} label="patch" tone="accent">
          <Chip tone="accent">{e.patch_id}</Chip> <span className="font-mono">{e.op}</span> on <span className="font-mono">{e.target}</span>{" "}
          {e.before && <StrandGlyph state={e.before} />} → {e.after && <StrandGlyph state={e.after} />}{" "}
          <span className="text-muted">— {e.reason}</span>
        </Row>
      );
    case "patch_applied":
      return (
        <Row e={e} label="apply" tone="accent">
          <Chip tone="accent">{e.patch_id}</Chip> <span className="text-muted">rev {e.workflow_revision}</span>
          {e.stale.length > 0 && (
            <>
              {" "}
              <span className="text-muted">stale:</span> <Chips ids={e.stale} />
            </>
          )}
        </Row>
      );
    case "harness_candidate":
    case "gate_result":
      // rendered by HarnessCard (see StepCard)
      return null;
    case "harness_promoted":
      return null;
    case "run_finished":
      return (
        <Row e={e} label="run" tone={e.status === "done" ? "ok" : "fail"}>
          finished · {e.status}
        </Row>
      );
    case "error":
      return (
        <Row e={e} label="error" tone="fail">
          {e.message}
        </Row>
      );
    case "paused":
    case "resumed":
    case "run_started":
    case "step_started":
      return (
        <Row e={e} label="run" tone="muted">
          {eventSummary(e)}
        </Row>
      );
  }
}

// F5: harness_candidate / gate_result / harness_promoted → one highlighted card that
// fills in as the loop progresses (patches → per-protocol deltas → promotion).
function HarnessCard({ v, e }: { v: HarnessVersionUI; e: RunEvent }) {
  const gate = v.gate;
  const pass = gate?.decision === "promote";
  return (
    <li
      data-kind={e.t}
      data-harness={v.id}
      data-seq={e.seq}
      className="rounded border border-accent/60 bg-accent/5 px-2 py-1.5 text-[11px] leading-4"
      title={`#${e.seq} ${e.t} · ${fmtTime(e.ts)}`}
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        <span className="tracking-widest text-accent uppercase">harness</span>
        <span className="text-[11px] font-semibold text-foreground">
          {v.id}
          {v.parent && <span className="font-normal text-muted"> ← {v.parent}</span>}
        </span>
        {gate ? <Chip tone={pass ? "accent" : "rose"}>{pass ? "PASS" : "REJECT"}</Chip> : <Chip>gating…</Chip>}
        {v.status === "active" && <Chip tone="accent">promoted → active</Chip>}
        <Link href="/harness" className="ml-auto text-muted underline decoration-line hover:text-foreground">
          /harness
        </Link>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {v.patches.map((p, i) => (
          <li key={i} title={p.reason}>
            <Chip>{p.type}</Chip> {p.scope && <Chip title="operation scope">{p.scope}</Chip>}{" "}
            <span className="font-mono">{p.path}</span>: <span className="text-muted">{fmtVal(p.from)}</span> →{" "}
            <span className="font-mono">{fmtVal(p.to)}</span>
          </li>
        ))}
        {v.patches.length === 0 && <li className="text-muted">no patches</li>}
      </ul>
      {gate && (
        <div className="mt-1">
          <ul className="font-mono text-[10px] tabular-nums">
            {gate.results.map((r) => (
              <li key={r.protocol_id} className="flex gap-2">
                <span className="w-8 text-muted">{r.role === "target" ? "tgt" : "reg"}</span>
                <span className="min-w-0 flex-1 truncate">{r.protocol_id}</span>
                <span className="text-muted">
                  {r.before.toFixed(2)} → {r.after.toFixed(2)}
                </span>
                <span className={cx("w-12 text-right", r.delta > 0 ? TONE.ok : r.delta < 0 ? TONE.fail : "text-muted")}>{fmtDelta(r.delta)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-0.5 text-muted">{gate.reason}</div>
        </div>
      )}
    </li>
  );
}

const HARNESS_EVENTS = new Set<RunEvent["t"]>(["harness_candidate", "gate_result", "harness_promoted"]);

// Post-loop phases get a quiet divider inside the last step's card.
function phaseOf(t: RunEvent["t"]): string | null {
  switch (t) {
    case "verifier_check":
    case "gt_scored":
    case "benchmark_scored":
      return "verifier";
    case "review_finding":
      return "reviewer";
    case "harness_candidate":
    case "gate_result":
    case "harness_promoted":
      return "harness";
    default:
      return null;
  }
}


function CheckGroupRow({ events, protocolId }: { events: Extract<RunEvent, { t: "verifier_check" }>[]; protocolId: string | null }) {
  const e = events[0];
  const ok = e.status === "pass";
  const ids = Array.from(new Set(events.map((x) => x.state_id).filter((x): x is string => Boolean(x))));
  const evidence = Array.from(new Set(events.flatMap((x) => x.evidence ?? [])));
  return (
    <Row e={e} label="check" tone={ok ? "ok" : "fail"}>
      <span className={TONE[ok ? "ok" : "fail"]}>{ok ? "✓" : "✗"}</span> <span className="font-mono" title={e.check}>{e.check.replace(/_/g, " ")}</span>{" "}
      <span className="rounded-sm border border-line px-1 font-mono text-[10px] text-muted tabular-nums" title={`${events.length} identical checks, seq ${events[0].seq}–${events[events.length - 1].seq}`}>
        ×{events.length}
      </span>{" "}
      <span className="text-muted">— {e.message}</span>{" "}
      {ids.map((id) => (
        <Chip key={id} tone={ok ? "muted" : "rose"}>
          {id}
        </Chip>
      ))}
      {evidence.length > 0 && <Chips ids={evidence} protocolId={protocolId} />}
    </Row>
  );
}

function StepCard({
  step,
  protocolId,
  harness,
  cardAt,
}: {
  step: TraceStep;
  protocolId: string | null;
  harness: HarnessUI;
  cardAt: Map<string, number>; // harness version → seq of the event that carries its card
}) {
  const rows: React.ReactNode[] = [];
  const skip = new Set<number>(); // seqs folded into a CheckGroupRow
  let phase: string | null = null;
  for (const e of step.events) {
    if (skip.has(e.seq)) continue;
    const p = phaseOf(e.t);
    if (p && p !== phase) {
      rows.push(
        <li key={`ph-${e.seq}`} className="mt-1 font-mono text-[9px] tracking-widest text-muted uppercase">
          {p}
        </li>,
      );
    }
    if (p) phase = p;
    if (HARNESS_EVENTS.has(e.t)) {
      const version = "version" in e ? e.version : "?";
      const v = harness.versions.find((x) => x.id === version);
      if (v && cardAt.get(version) === e.seq) rows.push(<HarnessCard key={e.seq} v={v} e={e} />);
      continue; // the other two events of the same version fold into that card
    }
    // A verifier often repeats one finding across many states; one row with ×N and the
    // state chips reads better than a wall of identical lines.
    if (e.t === "verifier_check") {
      const same = (x: RunEvent): x is Extract<RunEvent, { t: "verifier_check" }> =>
        x.t === "verifier_check" && x.check === e.check && x.status === e.status && x.message === e.message;
      const idx = step.events.indexOf(e);
      const group: Extract<RunEvent, { t: "verifier_check" }>[] = [e];
      for (let j = idx + 1; j < step.events.length; j++) {
        const x = step.events[j];
        if (!same(x)) break;
        group.push(x);
      }
      if (group.length > 1) {
        skip.add(e.seq);
        for (const g of group) skip.add(g.seq);
        rows.push(<CheckGroupRow key={e.seq} events={group} protocolId={protocolId} />);
        continue;
      }
    }
    rows.push(<EventRow key={e.seq} e={e} protocolId={protocolId} />);
  }
  return (
    <section className="border-b border-line px-3 py-2" data-kind="step_started" data-step={step.step}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted">{step.step === 0 ? "record" : `step ${step.step}`}</span>
        <span className="ml-auto font-mono text-[10px] text-muted tabular-nums">{fmtTime(step.ts)}</span>
      </div>
      <p className="text-[12px] leading-4">{step.goal}</p>
      {rows.length > 0 && <ul className="mt-1.5 flex flex-col gap-1">{rows}</ul>}
    </section>
  );
}

// ---------------------------------------------------------------- pane

export function Trace({ ui, className }: { ui: UIState; className?: string }) {
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const steps = ui.trace.slice(-MAX_STEPS);
  const hidden = ui.trace.length - steps.length;
  // One card per harness version, at its first visible event (pure: safe under re-render).
  const cardAt = new Map<string, number>();
  for (const st of steps) {
    for (const e of st.events) {
      if (HARNESS_EVENTS.has(e.t) && "version" in e && !cardAt.has(e.version)) cardAt.set(e.version, e.seq);
    }
  }

  useEffect(() => {
    const el = ref.current;
    if (!el || pinned) return;
    el.scrollTop = el.scrollHeight;
  }, [ui.lastSeq, pinned]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight > 48);
  };

  return (
    <aside className={cx("flex min-h-0 flex-col bg-panel", className)} aria-label="Agent trace">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[12px] font-medium">Agent trace</span>
        <span className="font-mono text-[10px] text-muted tabular-nums">
          {ui.trace.length} step{ui.trace.length === 1 ? "" : "s"} · {ui.lastSeq} events
        </span>
        <button
          onClick={() => setPinned((p) => !p)}
          className={cx(
            "ml-auto h-5 rounded border px-1.5 font-mono text-[10px] leading-4",
            pinned ? "border-accent text-accent" : "border-line text-muted hover:border-accent",
          )}
          title={pinned ? "Pinned: not following new events. Click to follow." : "Following new events. Click to pin the scroll position."}
        >
          {pinned ? "pinned" : "follow"}
        </button>
      </div>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {ui.runId ? (
          <div data-kind="run_started" className="border-b border-line px-3 py-1.5 font-mono text-[10px] text-muted">
            run {ui.protocolId} · harness {ui.harnessVersion}
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-[11px] text-muted">Waiting for events…</div>
        )}
        {hidden > 0 && (
          <div className="border-b border-line px-3 py-1 font-mono text-[10px] text-muted">
            … {hidden} earlier step{hidden === 1 ? "" : "s"} hidden
          </div>
        )}
        {steps.map((s) => (
          <StepCard key={s.seq} step={s} protocolId={ui.protocolId} harness={ui.harness} cardAt={cardAt} />
        ))}
      </div>
    </aside>
  );
}
