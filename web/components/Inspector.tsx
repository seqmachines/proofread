"use client";
// components/Inspector.tsx — "where did this come from?" for one state, read-only.
// Slides over the right edge of the canvas: strands, provenance (incoming transition
// incl. oligos/discards), the ground-truth comparison the run page loaded, failed checks
// and findings for this state, evidence chunks (GET /chunks/{id}, falling back to the
// search snippet), and any reviews already recorded in the run's history.
import { useEffect, useState } from "react";
import type { Chunk, GtDiff, Segment } from "@/lib/events";
import { oligoName } from "./TransitionEdge";
import type { MoleculeNode, UIState } from "@/lib/reducer";
import { getChunk } from "@/lib/api";
import { segmentColor, segmentText } from "@/lib/colors";
import { fmtTime, shortChunk } from "@/lib/format";
import { cx } from "@/lib/cx";

// ---------------------------------------------------------------- data hooks

const chunkCache = new Map<string, Promise<Chunk | null>>();
function loadChunk(id: string): Promise<Chunk | null> {
  let p = chunkCache.get(id);
  if (!p) {
    p = getChunk(id).catch(() => null);
    chunkCache.set(id, p);
  }
  return p;
}

function useChunks(ids: string[]): Record<string, Chunk | null> {
  const key = ids.join("\u0000");
  const [chunks, setChunks] = useState<Record<string, Chunk | null>>({});
  useEffect(() => {
    let cancelled = false;
    for (const id of key ? key.split("\u0000") : []) {
      void loadChunk(id).then((c) => {
        if (!cancelled) setChunks((m) => (id in m ? m : { ...m, [id]: c }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return chunks;
}

// gt-diff entries are MoleculeState-like objects (states) or {type, from, to} (edges); strings are ids.

const diffHas = (list: unknown[] | undefined, id: string) =>
  (list ?? []).some((x) => x === id || (typeof x === "object" && x !== null && (x as { id?: unknown }).id === id));

// ---------------------------------------------------------------- parts

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-2">
      <h3 className="mb-1 font-mono text-[9px] tracking-widest text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "rose" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-block rounded-sm border px-1 font-mono text-[10px] leading-[14px]",
        tone === "muted" && "border-line text-muted",
        tone === "accent" && "border-accent/50 text-accent",
        tone === "rose" && "border-rose-500/50 text-rose-600 dark:text-rose-400",
        tone === "warn" && "border-amber-500/50 text-amber-600 dark:text-amber-400",
      )}
    >
      {children}
    </span>
  );
}

function Strand({ name, ends, segments }: { name: string; ends: [string, string]; segments: Segment[] }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-muted">
        <span>{ends[0]}</span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-[2px]">
          {segments.length === 0 ? (
            <span className="h-4 flex-1 border-b border-dashed border-line" title="single-stranded" />
          ) : (
            segments.map((s, i) => (
              <span
                key={i}
                style={{ background: segmentColor(s.type), color: segmentText(s.type) }}
                className="h-4 rounded-[2px] px-1.5 font-mono text-[10px] leading-4 font-medium whitespace-nowrap"
              >
                {s.name}
              </span>
            ))
          )}
        </div>
        <span>{ends[1]}</span>
      </div>
      {segments.length > 0 && (
        <table className="w-full font-mono text-[10px] leading-4 tabular-nums">
          <tbody>
            {segments.map((s, i) => (
              <tr key={i} className="text-muted">
                <td className="w-6 pr-1 text-right">{i + 1}</td>
                <td className="pr-2 text-foreground">{s.name}</td>
                <td className="pr-2">
                  <span className="mr-1 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ background: segmentColor(s.type) }} />
                  {s.type}
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="sr-only">{name}</div>
    </div>
  );
}

// ---------------------------------------------------------------- inspector

export interface InspectorProps {
  node: MoleculeNode;
  ui: UIState;
  hasGt: boolean | null; // null = unknown (protocol list unavailable)
  gtDiff?: GtDiff | null; // loaded by the run page once the run has finished
  gtUnavailable?: boolean; // the comparison request failed
  onClose: () => void;
}

export function Inspector({ node, ui, hasGt, gtDiff, gtUnavailable = false, onClose }: InspectorProps) {
  const { state, ghost, stale, discarded } = node.data;
  const incoming = ui.edges.filter((e) => e.target === state.id && !e.data?.discard).map((e) => e.data!.transition);
  const evidenceIds = Array.from(new Set([...state.evidence, ...incoming.flatMap((t) => t.evidence)]));
  const chunks = useChunks(evidenceIds);
  const checks = ui.checks.filter((c) => c.state_id === state.id);
  const failedChecks = checks.filter((c) => c.status === "fail");
  const findings = ui.findings.filter((f) => f.state_id === state.id);
  const match = (gtDiff?.matched_states ?? []).find((m) => m.predicted?.id === state.id);
  const unmatched = gtDiff ? diffHas(gtDiff.extra_states, state.id) : false;
  const reviews = ui.reviews.filter((r) => r.target_id === state.id);
  const labelOf = (id: string) => ui.nodes.find((n) => n.id === id)?.data.state.label ?? id;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-[400px] max-w-[70%] flex-col border-l border-line bg-panel text-foreground shadow-[-8px_0_24px_rgba(0,0,0,0.08)]"
      style={{ animation: "drawer-in 160ms ease-out" }}
      aria-label={`Inspector ${state.id}`}
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-4 font-semibold" title={state.id}>
            {state.label}
          </div>
          <div className="mt-0.5 font-mono text-[10px] leading-3 text-muted" data-origin-line>
            {incoming.length > 0
              ? incoming.map((t) => (
                  <div key={t.id} className="truncate" title={`${t.op} ← ${labelOf(t.from)}${t.oligos?.length ? ` · ${t.oligos.map(oligoName).join(", ")}` : ""}`}>
                    {t.op.replace(/_/g, " ")} ← {labelOf(t.from)}
                    {t.oligos?.length ? ` · ${t.oligos.map(oligoName).join(", ")}` : ""}
                  </div>
                ))
              : ghost
                ? "proposed by a skill, not committed"
                : "input material"}
            {stale ? " · stale" : ""}
            {discarded ? " · not carried forward" : ""}
          </div>
        </div>
        <button
          onClick={onClose}
          className="h-5 w-5 shrink-0 rounded border border-line font-mono text-[11px] leading-4 text-muted hover:border-accent"
          title="Close (esc)"
          aria-label="Close inspector"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto text-[11px] leading-4">
        <Section title="strands">
          <Strand name="top" ends={["5′", "3′"]} segments={state.strands.top} />
          <Strand name="bottom" ends={["3′", "5′"]} segments={state.strands.bottom} />
        </Section>

        {(hasGt === true || match || unmatched) && (
          <Section title="ground truth">
            {match ? (
              <div className="flex items-center gap-1.5" data-gt-canonical>
                <Tag tone={match.similarity >= 0.8 ? "accent" : "warn"}>similarity {match.similarity.toFixed(2)}</Tag>
                <span className="truncate" title={match.truth.id}>
                  {match.truth.label ?? match.truth.id}
                </span>
              </div>
            ) : unmatched ? (
              <Tag tone="rose">no ground-truth counterpart</Tag>
            ) : (
              <span className="text-muted">
                {gtDiff ? "not part of the comparison" : gtUnavailable ? "the comparison could not be loaded" : "loads when the run has finished"}
              </span>
            )}
          </Section>
        )}

        {(failedChecks.length > 0 || findings.length > 0) && (
          <Section title={`failed checks · ${failedChecks.length}`}>
            {failedChecks.map((c, i) => (
              <div key={i} className="mb-1 last:mb-0">
                <span className="text-rose-600 dark:text-rose-400">✗</span>{" "}
                <span className="font-mono" title={c.check}>{c.check.replace(/_/g, " ")}</span> <span className="text-muted">— {c.message}</span>
              </div>
            ))}
            {findings.map((f) => (
              <div key={f.signal_id} className="mt-1 border-l-2 border-rose-500/70 pl-2">
                <div>{f.finding}</div>
                <div className="font-mono text-[10px] text-muted">{f.recommended_action}</div>
              </div>
            ))}
          </Section>
        )}

        <Section title={`evidence · ${evidenceIds.length}`}>
          {evidenceIds.length === 0 && <div className="text-muted">none — {state.origin === "skill" ? "skill provenance" : "no chunks cited"}</div>}
          {evidenceIds.map((id) => {
            const hit = ui.chunks[id];
            const chunk = chunks[id];
            const text = chunk?.text ?? hit?.snippet;
            const page = chunk?.page ?? hit?.page;
            return (
              <div key={id} className="mb-2 last:mb-0">
                <div className="flex items-center gap-1">
                  <Tag tone="accent">
                    <span title={id}>{shortChunk(id, ui.protocolId)}</span>
                  </Tag>
                  {page !== undefined && <Tag>p{page}</Tag>}
                  {chunk === undefined && <span className="text-muted">loading…</span>}
                  {chunk === null && !hit && <span className="text-muted">chunk not on the backend</span>}
                </div>
                {text && <p className="mt-0.5 whitespace-pre-line text-[11px] leading-4">{text.replace(/[ \t]{2,}/g, " ")}</p>}
              </div>
            );
          })}
        </Section>

        {reviews.length > 0 && (
          <Section title={`reviews · ${reviews.length}`}>
            <ul className="flex flex-col gap-1">
              {reviews.map((r) => (
                <li key={r.review_id} data-review-row={r.review_id}>
                  <Tag tone={r.decision === "reject" ? "rose" : r.decision === "unresolved" ? "warn" : "accent"}>{r.decision}</Tag>{" "}
                  <span className="font-mono text-[10px] text-muted">
                    {r.reviewer.name ?? r.reviewer.id} · {fmtTime(r.ts)}
                  </span>
                  {r.note && <div className="text-muted">{r.note}</div>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </aside>
  );
}
