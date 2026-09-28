"use client";
// components/MemoryPage.tsx — /memory (SPEC.md §6): verified cDNA entities, their provenance,
// and the review that created each one. Live data only (GET /memory?operation=&type=).
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Entity, Review } from "@/lib/events";
import { API_URL, getMemory, getProtocols, getReviews } from "@/lib/api";
import { SEGMENT_TYPES, segmentColor } from "@/lib/colors";
import { fmtTime } from "@/lib/format";
import { cx } from "@/lib/cx";
import { isAuthor, useReviewer } from "@/lib/reviewer";

const OPS = ["reverse_transcription", "template_switching", "pcr", "fragmentation", "ligation", "tagmentation", "other"];
const field =
  "h-6 rounded border border-line bg-panel px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-accent";

function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-block rounded-sm border px-1 font-mono text-[10px] leading-[14px] whitespace-nowrap", className ?? "border-line text-muted")}>
      {children}
    </span>
  );
}

/** Reviews are stored per run; an entity names only its review_id and protocol. Look through
 *  that protocol's runs (from /protocols sources) until the review turns up. */
async function findReview(entity: Entity): Promise<{ review: Review; run_id: string } | null> {
  const { review_id, run_id } = entity.provenance ?? {};
  if (!review_id) return null;
  const candidates = run_id ? [run_id] : [];
  if (!run_id && entity.protocol_id) {
    const protocols = await getProtocols();
    for (const p of protocols) if (p.id === entity.protocol_id) for (const s of p.sources ?? []) if (typeof s === "object" && s?.run_id) candidates.push(s.run_id);
  }
  for (const id of candidates) {
    const rs = await getReviews(id).catch(() => [] as Review[]);
    const hit = rs.find((r) => r._id === review_id);
    if (hit) return { review: hit, run_id: id };
  }
  return null;
}

/** The review that created an entity, fetched when the row is expanded. */
function ProvenanceReview({ entity }: { entity: Entity }) {
  const { review_id, run_id } = entity.provenance ?? {};
  const [found, setFound] = useState<{ review: Review; run_id: string } | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    findReview(entity)
      .then((f) => {
        if (!cancelled) setFound(f);
      })
      .catch(() => {
        if (!cancelled) setFound(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entity]);
  if (!review_id) return <div className="text-muted">created by a promoted run{run_id ? ` (${run_id})` : ""}, not a review</div>;
  if (found === undefined) return <div className="text-muted">looking up review {review_id}…</div>;
  if (found === null) return <div className="text-muted">review {review_id} was not found on the runs of {entity.protocol_id ?? "its protocol"}</div>;
  const review = found.review;
  return (
    <div className="flex flex-col gap-0.5" data-provenance-review={review._id}>
      <div>
        <Chip className={review.decision === "reject" ? "border-rose-500/50 text-rose-600 dark:text-rose-400" : "border-accent/50 text-accent"}>{review.decision}</Chip>{" "}
        <span className="font-mono">{review.target_id}</span>{" "}
        <span className="text-muted">
          by {review.reviewer?.name ?? review.reviewer?.id} ({review.reviewer?.role}) · rev {review.workflow_revision} · {fmtTime(review.created_at)}
        </span>{" "}
        <Link href={`/runs/${encodeURIComponent(found.run_id)}`} className="text-muted underline decoration-line hover:text-foreground">
          open run →
        </Link>
      </div>
      {review.error_type && <div className="font-mono text-[10px] text-muted">{review.error_type}</div>}
      {review.note && <div className="text-muted">{review.note}</div>}
    </div>
  );
}

export function MemoryPage() {
  const reviewer = useReviewer();
  const [operation, setOperation] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState<{ entities: Entity[] | null; error: string | null }>({ entities: null, error: null });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMemory({ operation: operation || undefined, type: type || undefined })
      .then((es) => {
        if (!cancelled) setState({ entities: es, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ entities: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [operation, type]);

  const { entities, error } = state;
  const keyOf = (e: Entity, i: number) => e._id ?? e.memory_key ?? `${e.name}:${i}`;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
        <Link href="/" className="font-mono font-semibold tracking-tight">
          proofread
        </Link>
        <span className="text-muted">/</span>
        <span className="font-mono text-muted">memory</span>
        <span className="ml-3 font-mono text-[10px] text-muted">operation</span>
        <select value={operation} onChange={(e) => setOperation(e.target.value)} className={field} aria-label="Operation filter">
          <option value="">any</option>
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px] text-muted">type</span>
        <select value={type} onChange={(e) => setType(e.target.value)} className={field} aria-label="Type filter">
          <option value="">any</option>
          {SEGMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {entities && (
          <span className="font-mono text-[10px] text-muted tabular-nums" data-memory-count={entities.length}>
            {entities.length} verified
          </span>
        )}
        <span className="ml-auto flex gap-3 font-mono text-[11px] text-muted">
          <Link href="/queue" className="underline decoration-line hover:text-foreground">
            queue
          </Link>
          <Link href="/benchmark" className="underline decoration-line hover:text-foreground">
            benchmark
          </Link>
          {!isAuthor(reviewer) && (
            <Link href="/harness" className="underline decoration-line hover:text-foreground">
              harness
            </Link>
          )}
        </span>
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto w-full max-w-[1100px]">
          <div className="mb-2 font-mono text-[11px] text-muted">
            verified entities from cDNA memory · provenance points at the review (or promoted run) that created each one · source {API_URL}/memory
          </div>
          {error && (
            <div className="rounded border border-rose-600/40 bg-rose-600/10 px-2 py-1 font-mono text-[11px] text-rose-600 dark:text-rose-400" data-memory-error>
              {error}
            </div>
          )}
          {entities === null && !error && <div className="font-mono text-[11px] text-muted">loading…</div>}
          {entities && entities.length === 0 && (
            <div className="rounded border border-line bg-panel px-3 py-2 text-[12px] text-muted" data-memory-empty>
              No verified entities yet. An accepted state or transition becomes a memory candidate; it is verified once the same entity is accepted in a
              second protocol, or when a curator marks it (SPEC.md §5 step 3).
            </div>
          )}
          {entities && entities.length > 0 && (
            <table className="w-full border-collapse text-[12px]" data-memory>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-wide text-muted uppercase">
                  <th className="py-1 pr-3 text-left font-normal">entity</th>
                  <th className="py-1 pr-3 text-left font-normal">type</th>
                  <th className="py-1 pr-3 text-left font-normal">operation</th>
                  <th className="py-1 pr-3 text-left font-normal">substrate</th>
                  <th className="py-1 pr-3 text-left font-normal">assay family</th>
                  <th className="py-1 pr-3 text-left font-normal">aliases</th>
                  <th className="py-1 pr-3 text-left font-normal">provenance</th>
                  <th className="py-1 text-right font-normal">created</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((e, i) => {
                  const k = keyOf(e, i);
                  const isOpen = open === k;
                  const color = SEGMENT_TYPES.includes(e.type as (typeof SEGMENT_TYPES)[number]) ? segmentColor(e.type) : null;
                  return [
                    <tr
                      key={k}
                      data-entity={k}
                      onClick={() => setOpen(isOpen ? null : k)}
                      className="cursor-pointer border-b border-line/60 align-top hover:bg-panel"
                      title="click for the review that created this entity"
                    >
                      <td className="py-1.5 pr-3 font-medium">
                        {e.name}
                        {e.sequence && <span className="ml-1.5 font-mono text-[10px] text-muted">seq</span>}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px]">
                        {color && <span className="mr-1 inline-block h-2 w-3 rounded-[1px] align-middle" style={{ background: color }} />}
                        {e.type}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{e.operation ?? "—"}</td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{e.substrate ?? "—"}</td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{e.assay_family ?? "—"}</td>
                      <td className="py-1.5 pr-3">
                        <span className="flex flex-wrap gap-1">
                          {(e.aliases ?? []).map((a) => (
                            <Chip key={a}>{a}</Chip>
                          ))}
                          {(e.aliases ?? []).length === 0 && <span className="font-mono text-[11px] text-muted">—</span>}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px]">
                        {e.provenance?.review_id ? <Chip className="border-accent/50 text-accent">{e.provenance.review_id}</Chip> : <Chip>promoted run</Chip>}{" "}
                        {e.provenance?.run_id && (
                          <Link href={`/runs/${encodeURIComponent(e.provenance.run_id)}`} onClick={(ev) => ev.stopPropagation()} className="text-muted underline decoration-line hover:text-foreground">
                            run →
                          </Link>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono text-[11px] text-muted tabular-nums">{fmtTime(e.created_at)}</td>
                    </tr>,
                    isOpen ? (
                      <tr key={`${k}:review`} className="border-b border-line/60 bg-panel">
                        <td colSpan={8} className="px-3 py-2 text-[11px]">
                          <ProvenanceReview entity={e} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
