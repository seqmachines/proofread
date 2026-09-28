"use client";
// components/Inspector.tsx — "where did this come from?" for one state, and the place
// a human decides about it (F8: accept / modify / reject / unresolved + note → POST
// /runs/{id}/reviews). Slides over the right edge of the canvas: strands with per-segment origin, provenance (skill
// call, incoming transition incl. oligos/discards), evidence chunks (GET /chunks/{id},
// falling back to the search snippet), checks + findings for this state, GT diff
// (GET /runs/{id}/gt-diff; 404 → "not yet" until M4).
import { useEffect, useState } from "react";
import { ERROR_TYPES, type Chunk, type ErrorType, type GtDiff, type GtTransition, type MoleculeState, type ReviewDecision, type Segment } from "@/lib/events";
import type { MoleculeNode, UIState } from "@/lib/reducer";
import { ApiError, getChunk, getGtDiff } from "@/lib/api";
import { segmentColor, segmentText } from "@/lib/colors";
import { fmtTime, shortChunk } from "@/lib/format";
import { StrandGlyph } from "./StrandGlyph";
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

function useGtDiff(runId: string | null, hasGt: boolean | null, given: GtDiff | null | undefined): { diff: GtDiff | null; note: string | null } {
  const [state, setState] = useState<{ diff: GtDiff | null; note: string | null }>({ diff: null, note: null });
  useEffect(() => {
    if (!runId || hasGt !== true || given) return;
    let cancelled = false;
    getGtDiff(runId)
      .then((diff) => {
        if (!cancelled) setState({ diff, note: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const note =
          e instanceof ApiError && e.status === 404
            ? "no GT diff for this run yet (endpoint lands with M4)"
            : `gt-diff unavailable: ${e instanceof Error ? e.message : String(e)}`;
        setState({ diff: null, note });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, hasGt, given]);
  return given ? { diff: given, note: null } : state;
}

// gt-diff entries are MoleculeState-like objects (states) or {type, from, to} (edges); strings are ids.
function GtList({ title, items, kind }: { title: string; items: unknown[] | undefined; kind: "state" | "edge" | "transition" | "gt-transition" }) {
  const list = items ?? [];
  const [open, setOpen] = useState(false);
  if (list.length === 0) return null;
  const shown = open ? list : list.slice(0, 4);
  return (
    <div className="mb-1.5">
      <div className="font-mono text-[10px] text-muted">
        {title} · {list.length}
      </div>
      <ul className="flex flex-col gap-0.5">
        {shown.map((x, i) => {
          if (typeof x === "string") return <li key={i} className="font-mono text-[10px]">{x}</li>;
          const o = (x as Record<string, unknown>) ?? {};
          if (kind === "state" && o.strands) {
            const st = o as unknown as MoleculeState;
            return (
              <li key={i} className="flex items-center gap-1.5">
                <StrandGlyph state={st} />
                <span className="truncate" title={`${st.id} — ${st.label}`}>
                  {st.label ?? st.id}
                </span>
              </li>
            );
          }
          if (kind === "edge" || kind === "transition") {
            return (
              <li key={i} className="font-mono text-[10px]">
                {String(o.from ?? o.source ?? "?")} → {String(o.to ?? o.target ?? "?")}{" "}
                <span className="text-muted">({String(o.op ?? o.type ?? "?")})</span>
              </li>
            );
          }
          if (kind === "gt-transition") {
            const t = o as unknown as GtTransition;
            return (
              <li key={i} className="font-mono text-[10px]">
                {t.operation} <span className="text-muted">{(t.substrate_state_ids ?? []).join(", ")} → {(t.product_state_ids ?? []).join(", ")}</span>
              </li>
            );
          }
          return <li key={i} className="font-mono text-[10px] text-muted">{JSON.stringify(x).slice(0, 80)}</li>;
        })}
      </ul>
      {list.length > 4 && (
        <button onClick={() => setOpen((v) => !v)} className="font-mono text-[10px] text-muted underline decoration-line hover:text-foreground">
          {open ? "show fewer" : `show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

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
                <td className="text-right">{s.origin}</td>
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
  runId: string | null; // null for the fixture (no backend run)
  hasGt: boolean | null; // null = unknown (protocol list unavailable)
  gtDiff?: GtDiff | null; // already fetched by "Compare with ground truth"
  onReview: (decision: Exclude<ReviewDecision, "modify">, note: string, systematic: boolean, errorType: ErrorType | null) => Promise<void>;
  onModify: (note: string, errorType: ErrorType) => void; // opens the patch card path (chat → editor → apply as modify)
  onDraft?: (sentence: string, errorType: ErrorType) => void; // no chat editor: draft the patch locally from a sentence
  scopeNotice?: string | null; // author invited for another protocol: writes will be refused
  onClose: () => void;
}

const field =
  "h-6 rounded border border-line bg-panel px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-accent";

const DECISIONS: { id: ReviewDecision; label: string; cls: string; hint: string }[] = [
  { id: "accept", label: "accept", cls: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400", hint: "correct as reconstructed → memory candidate" },
  { id: "modify", label: "modify", cls: "border-accent/60 text-accent", hint: "describe the fix in chat; applying the patch records the review" },
  { id: "reject", label: "reject", cls: "border-rose-500/60 text-rose-600 dark:text-rose-400", hint: "remove this state; downstream goes stale → signal" },
  { id: "unresolved", label: "unresolved", cls: "border-amber-500/60 text-amber-600 dark:text-amber-400", hint: "needs another look; counted in the queue" },
];

function ReviewSection({
  targetId,
  ui,
  onReview,
  onModify,
  onDraft,
  scopeNotice,
}: {
  targetId: string;
  ui: UIState;
  onReview: InspectorProps["onReview"];
  onModify: InspectorProps["onModify"];
  onDraft?: InspectorProps["onDraft"];
  scopeNotice?: string | null;
}) {
  const [note, setNote] = useState("");
  const [systematic, setSystematic] = useState(false);
  const [errorType, setErrorType] = useState<ErrorType | "">("");
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sentence, setSentence] = useState("");
  const history = ui.reviews.filter((r) => r.target_id === targetId);
  const needsType = (d: ReviewDecision) => d === "modify" || d === "reject";
  const decide = async (d: ReviewDecision) => {
    if (needsType(d) && !errorType) {
      setError("choose the error category first (required for modify and reject)");
      return;
    }
    if (d === "modify") {
      if (onDraft) {
        setDrafting(true);
        setSentence(note.trim());
        return;
      }
      onModify(note.trim(), errorType as ErrorType);
      return;
    }
    setBusy(d);
    setError(null);
    try {
      await onReview(d, note.trim(), systematic, needsType(d) ? (errorType as ErrorType) : null);
      setNote("");
      setErrorType("");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/cancelled/.test(m) ? "nothing recorded — a reviewer identity is needed to save a decision" : m);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title={`review · ${history.length}`}>
      {scopeNotice && (
        <div className="mb-1.5 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-700 dark:text-amber-400" data-scope-notice>
          {scopeNotice}
        </div>
      )}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Review decision" data-review-actions>
        {DECISIONS.map((d) => (
          <button
            key={d.id}
            onClick={() => void decide(d.id)}
            disabled={busy !== null || (needsType(d.id) && !errorType)}
            title={needsType(d.id) && !errorType ? `${d.hint} — pick an error category first` : d.hint}
            className={cx("h-6 rounded border bg-panel px-2 font-mono text-[11px] leading-5 hover:bg-background disabled:opacity-40", d.cls)}
          >
            {busy === d.id ? "…" : d.label}
          </button>
        ))}
      </div>
      <label className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-muted">
        <span className="shrink-0">error category</span>
        <select value={errorType} onChange={(e) => setErrorType(e.target.value as ErrorType | "")} className={cx(field, "min-w-0 flex-1")} aria-label="Error category" data-error-type>
          <option value="">— required for modify / reject —</option>
          {ERROR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional) — why; for modify, this seeds the chat"
        className="mt-1.5 w-full resize-none rounded border border-line bg-panel px-2 py-1 text-[11px] leading-4 text-foreground outline-none placeholder:text-muted/70 focus:border-accent"
        aria-label="Review note"
      />
      <label className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted">
        <input type="checkbox" checked={systematic} onChange={(e) => setSystematic(e.target.checked)} className="accent-accent" />
        this will recur (systematic → harness signal)
      </label>
      {drafting && onDraft && (
        <div className="mt-1.5 rounded border border-accent/50 px-2 py-1.5" data-modify-composer>
          <div className="mb-1 font-mono text-[10px] text-muted">describe the change — e.g. “add a 5′ handle to the top strand” or “remove the primer”</div>
          <div className="flex items-center gap-1.5">
            <input
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && sentence.trim()) {
                  onDraft(sentence.trim(), errorType as ErrorType);
                  setDrafting(false);
                }
              }}
              placeholder="what should change on this state"
              className="h-6 min-w-0 flex-1 rounded border border-line bg-panel px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-accent"
              aria-label="Modify sentence"
              autoFocus
            />
            <button
              className="h-6 rounded border border-accent px-2 font-mono text-[11px] leading-5 text-accent disabled:opacity-40"
              disabled={!sentence.trim()}
              onClick={() => {
                onDraft(sentence.trim(), errorType as ErrorType);
                setDrafting(false);
              }}
              data-modify-draft
            >
              draft patch
            </button>
            <button className="h-6 rounded border border-line px-2 font-mono text-[11px] leading-5 text-muted" onClick={() => setDrafting(false)}>
              cancel
            </button>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted">the patch card appears at the bottom; applying it records the modify review</div>
        </div>
      )}
      {error && <div className={cx("mt-1 font-mono text-[10px]", /nothing recorded/.test(error) ? "text-muted" : "text-rose-600 dark:text-rose-400")}>{error}</div>}
      {history.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 border-t border-line pt-1.5">
          {history.map((r) => (
            <li key={r.review_id} className="text-[11px]" data-review-row={r.review_id}>
              <Tag tone={r.decision === "reject" ? "rose" : r.decision === "unresolved" ? "warn" : "accent"}>{r.decision}</Tag>{" "}
              <span className="font-mono text-[10px] text-muted">
                {r.review_id} · {r.reviewer.name ?? r.reviewer.id} · {fmtTime(r.ts)}
              </span>
              {r.note && <div className="text-muted">{r.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function Inspector({ node, ui, runId, hasGt, gtDiff, onReview, onModify, onDraft, scopeNotice, onClose }: InspectorProps) {
  const { state, ghost, stale, discarded } = node.data;
  const incoming = ui.edges.filter((e) => e.target === state.id && !e.data?.discard).map((e) => e.data!.transition);
  const outgoing = ui.edges.filter((e) => e.source === state.id && !e.data?.discard).map((e) => e.data!.transition);
  const discardedBy = ui.edges.find((e) => e.data?.discard === state.id)?.data?.transition;
  const skill = state.skill_call_id ? ui.skillCalls[state.skill_call_id] : undefined;
  const evidenceIds = Array.from(new Set([...state.evidence, ...incoming.flatMap((t) => t.evidence)]));
  const chunks = useChunks(evidenceIds);
  const checks = ui.checks.filter((c) => c.state_id === state.id);
  const findings = ui.findings.filter((f) => f.state_id === state.id);
  const gt = useGtDiff(runId, hasGt, gtDiff);

  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-[400px] max-w-[70%] flex-col border-l border-line bg-panel text-foreground shadow-[-8px_0_24px_rgba(0,0,0,0.08)]"
      style={{ animation: "drawer-in 160ms ease-out" }}
      aria-label={`Inspector ${state.id}`}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-[11px] text-muted">{state.id}</span>
        <span className="truncate text-[12px] font-medium">{state.label}</span>
        <button
          onClick={onClose}
          className="ml-auto h-5 w-5 rounded border border-line font-mono text-[11px] leading-4 text-muted hover:border-accent"
          title="Close (esc)"
          aria-label="Close inspector"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto text-[11px] leading-4">
        <Section title="state">
          <div className="flex flex-wrap gap-1">
            <Tag>origin {state.origin}</Tag>
            <Tag>rev {ui.workflowRevision}</Tag>
            <Tag tone={state.review_status === "rejected" ? "rose" : state.review_status === "unresolved" ? "warn" : state.review_status === "unreviewed" ? "muted" : "accent"}>
              {state.review_status}
            </Tag>
            {ghost && <Tag tone="warn">proposed by skill, not committed</Tag>}
            {stale && <Tag tone="warn">stale since rev {state.stale_since_revision}</Tag>}
            {discarded && <Tag tone="warn">discarded by {discardedBy?.id ?? "transition"}</Tag>}
          </div>
        </Section>

        <ReviewSection targetId={state.id} ui={ui} onReview={onReview} onModify={onModify} onDraft={onDraft} scopeNotice={scopeNotice} />

        <Section title="strands">
          <Strand name="top" ends={["5′", "3′"]} segments={state.strands.top} />
          <Strand name="bottom" ends={["3′", "5′"]} segments={state.strands.bottom} />
        </Section>

        {state.benchmark_structure && (
          <Section title={`benchmark structure · ${state.benchmark_structure.strands.length} strands`}>
            <div className="mb-1 font-mono text-[10px] text-muted">
              {state.benchmark_structure.strand_architecture} · reference {state.benchmark_structure.reference_strand_id}
              {state.benchmark_structure.paired_regions?.length ? ` · ${state.benchmark_structure.paired_regions.length} paired regions` : ""}
              {state.benchmark_structure.discontinuities?.length ? ` · ${state.benchmark_structure.discontinuities.length} discontinuities` : ""}
            </div>
            {state.benchmark_structure.strands.map((st) => (
              <div key={st.strand_id} className="mb-1.5 last:mb-0" data-bench-strand={st.strand_id}>
                <div className="font-mono text-[10px]">
                  <span className={st.strand_id === state.benchmark_structure?.reference_strand_id ? "text-foreground" : "text-muted"}>{st.strand_id}</span>{" "}
                  <span className="text-muted">
                    {st.molecule_type} · {st.orientation}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {st.segments.map((sg) => (
                    <Tag key={sg.segment_id} tone={sg.support_status && sg.support_status !== "supported" ? "warn" : "muted"}>
                      {sg.role}
                      {sg.structural_role ? ` · ${sg.structural_role}` : ""}
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </Section>
        )}

        <Section title="provenance">
          {skill && (
            <div className="mb-1">
              <span className="text-muted">skill</span>{" "}
              <span className="font-mono">
                {skill.skill}({skill.inputs.substrate_id}, {skill.inputs.oligo})
              </span>{" "}
              <Tag>{skill.skill_call_id}</Tag>
              {skill.error && <span className="text-rose-600 dark:text-rose-400"> ✗ {skill.error}</span>}
            </div>
          )}
          {incoming.length === 0 && !skill && <div className="text-muted">{ghost ? "skill output" : "input state — no incoming transition"}</div>}
          {incoming.map((t) => (
            <div key={t.id} className="mb-1">
              <span className="text-muted">from</span> <span className="font-mono">{t.from}</span> via{" "}
              <span className="font-mono">{t.op}</span>{" "}
              {t.skill_call_id ? <Tag>{t.skill_call_id}</Tag> : <Tag>llm-constructed</Tag>} <Tag>{t.id}</Tag>
              {!!t.oligos?.length && (
                <div>
                  <span className="text-muted">oligos</span>{" "}
                  {t.oligos.map((o) => (
                    <Tag key={o} tone="accent">
                      {o}
                    </Tag>
                  ))}
                </div>
              )}
              {!!t.discarded?.length && (
                <div>
                  <span className="text-muted">discards</span>{" "}
                  {t.discarded.map((d) => (
                    <Tag key={d}>{d}</Tag>
                  ))}
                </div>
              )}
            </div>
          ))}
          {outgoing.length > 0 && (
            <div className="text-muted">
              to{" "}
              {outgoing.map((t) => (
                <span key={t.id} className="mr-1 font-mono text-foreground">
                  {t.to} <span className="text-muted">({t.op})</span>
                </span>
              ))}
            </div>
          )}
        </Section>

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
                  {chunk === null && hit && <span className="text-muted">search snippet</span>}
                  {chunk === null && !hit && <span className="text-muted">chunk not on the backend</span>}
                </div>
                {text && <p className="mt-0.5 whitespace-pre-line text-[11px] leading-4">{text.replace(/[ \t]{2,}/g, " ")}</p>}
              </div>
            );
          })}
        </Section>

        <Section title={`checks · ${checks.length}`}>
          {checks.length === 0 && <div className="text-muted">no check targets this state</div>}
          {checks.map((c, i) => (
            <div key={i} className="mb-1 last:mb-0">
              <span className={c.status === "pass" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                {c.status === "pass" ? "✓" : "✗"}
              </span>{" "}
              <span className="font-mono" title={c.check}>{c.check.replace(/_/g, " ")}</span> <span className="text-muted">— {c.message}</span>
            </div>
          ))}
          {findings.map((f) => (
            <div key={f.signal_id} className="mt-1 border-l-2 border-rose-500/70 pl-2">
              <Tag tone="rose">{f.signal_id}</Tag> <Tag>{f.operation}</Tag>{" "}
              <Tag tone={f.harness_relevance === "high" ? "accent" : "muted"}>relevance {f.harness_relevance}</Tag>
              <div className="mt-0.5">{f.finding}</div>
              <div className="font-mono text-[10px] text-muted">
                {f.root_cause} → {f.recommended_action}
              </div>
            </div>
          ))}
        </Section>

        <Section title="ground truth">
          {hasGt === false && <div className="text-muted">protocol has no ground truth</div>}
          {hasGt === null && <div className="text-muted">unknown — protocol list unavailable</div>}
          {hasGt === true && gt.note && <div className="text-muted">{gt.note}</div>}
          {hasGt === true && !gt.diff && !gt.note && <div className="text-muted">loading…</div>}
          {gt.diff && (
            <div className="text-[11px]" data-gt-canonical>
              {(() => {
                const match = (gt.diff.matched_states ?? []).find((m) => m.predicted?.id === state.id);
                const extra = diffHas(gt.diff.extra_states, state.id);
                return match ? (
                  <div className="mb-1.5 rounded border border-line px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <Tag tone={match.similarity >= 0.8 ? "accent" : "warn"}>matched · similarity {match.similarity.toFixed(2)}</Tag>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <StrandGlyph state={match.truth} />
                      <span className="truncate" title={match.truth.id}>
                        {match.truth.label ?? match.truth.id}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted">the ground-truth state this one aligns to, by segment structure</div>
                  </div>
                ) : (
                  <div className="mb-1.5">
                    <Tag tone={extra ? "rose" : "muted"}>{extra ? "no ground-truth counterpart" : "not part of the comparison"}</Tag>
                  </div>
                );
              })()}
              <div className="mb-1 font-mono text-[10px] text-muted">
                {(gt.diff.matched_states ?? []).length} states matched · {(gt.diff.missing_states ?? []).length} GT unmatched ·{" "}
                {(gt.diff.extra_states ?? []).length} predicted unmatched · transitions {(gt.diff.matched_transitions ?? []).length} matched /{" "}
                {(gt.diff.missing_transitions ?? []).length} GT unmatched / {(gt.diff.extra_transitions ?? []).length} predicted unmatched
              </div>
              <GtList title="ground-truth states with no match in this run" items={gt.diff.missing_states} kind="state" />
              <GtList title="predicted states with no ground-truth match" items={gt.diff.extra_states} kind="state" />
              <GtList title="ground-truth transitions with no match" items={gt.diff.missing_transitions} kind="gt-transition" />
              <GtList title="predicted transitions with no match" items={gt.diff.extra_transitions} kind="transition" />
              {(gt.diff.matched_transitions ?? []).length > 0 && (
                <details className="mb-1">
                  <summary className="cursor-pointer font-mono text-[10px] text-muted">matched transitions · {(gt.diff.matched_transitions ?? []).length}</summary>
                  <ul className="mt-0.5 flex flex-col gap-0.5 font-mono text-[10px]">
                    {(gt.diff.matched_transitions ?? []).map((m, i) => (
                      <li key={i}>
                        {m.predicted.op} <span className="text-muted">↔ {m.truth.operation}</span> <Tag>{m.similarity.toFixed(2)}</Tag>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {ui.gtScore && (
            <div className="mt-1 font-mono text-[10px] text-muted tabular-nums">
              structure_f1 {ui.gtScore.structure_f1.toFixed(2)} · edge_f1 {ui.gtScore.edge_f1.toFixed(2)}
            </div>
          )}
          {ui.benchmarkScore && (
            <div className="mt-1 font-mono text-[10px] text-muted tabular-nums" title="saved benchmark metrics (original names); not structure_f1">
              benchmark {ui.benchmarkScore.benchmark_version} ·{" "}
              {Object.entries(ui.benchmarkScore.metrics)
                .map(([k, v]) => `${k} ${v.toFixed(2)}`)
                .join(" · ")}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
}
