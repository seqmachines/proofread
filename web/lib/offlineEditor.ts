// lib/offlineEditor.ts — a tiny deterministic stand-in for the backend editor (M8),
// used only by /runs/fixture so chat → diff card → apply → stale works offline.
// It emits the same events the backend would (human_message, patch_proposed,
// state_revised, patch_applied), so everything downstream is the real reducer.
import type { MoleculeState, ReviewInput, Reviewer, RunEvent, Segment, SegmentType } from "./events";
import type { Patch, UIState } from "./reducer";

const now = () => new Date().toISOString();

const TYPE_WORDS: [RegExp, SegmentType][] = [
  [/\badapt(?:er|or)s?\b/, "adapter"],
  [/\bbarcodes?\b|\bcb\b/, "barcode"],
  [/\bumis?\b/, "umi"],
  [/\binserts?\b/, "insert"],
  [/\bprimers?\b/, "primer"],
  [/\btsos?\b|template[- ]switch/, "tso"],
  [/\bhandles?\b/, "handle"],
  [/\bindex(?:es)?\b|\bi[57]\b/, "index"],
  [/poly\s?\(?a\)?|\bpolya\b|poly-a/, "polyA"],
];
const LABEL: Record<SegmentType, string> = {
  adapter: "Adapter", barcode: "Barcode", umi: "UMI", insert: "Insert", primer: "Primer",
  tso: "TSO", handle: "Handle", index: "Index", polyA: "poly(A)", other: "Segment",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The state the sentence names — by id ("S2", "cdna_amp", "S_6f364bc90a39") or by its
// label ("the amplified cDNA"); the longest match wins. Else the selected state, else
// the last carried-forward state.
function pickTarget(ui: UIState, text: string, defaultId?: string | null): MoleculeState | null {
  const lower = text.toLowerCase();
  const byId = ui.nodes
    .filter((n) => !n.data.ghost && new RegExp(`(^|[^a-z0-9_.])${escapeRe(n.id.toLowerCase())}(?![a-z0-9_.])`).test(lower))
    .sort((a, b) => b.id.length - a.id.length)[0];
  const byLabel = ui.nodes
    .filter((n) => !n.data.ghost && n.data.state.label.length >= 6 && lower.includes(n.data.state.label.toLowerCase()))
    .sort((a, b) => b.data.state.label.length - a.data.state.label.length)[0];
  const mentioned = byId ?? byLabel;
  const chosen = defaultId ? ui.nodes.find((n) => n.id === defaultId && !n.data.ghost) : undefined;
  const node = mentioned ?? chosen ?? [...ui.nodes].reverse().find((n) => !n.data.ghost && !n.data.discarded);
  return node?.data.state ?? null;
}

function parse(text: string) {
  const lower = text.toLowerCase();
  const remove = /\b(?:remove|delete|drop|strip)\b/.test(lower);
  const type = TYPE_WORDS.find(([re]) => re.test(lower))?.[1] ?? "other";
  const quoted = text.match(/["“']([^"”']+)["”']/)?.[1];
  const phrase = text.match(/\b(?:add|attach|append|prepend|insert|put)\s+(?:a|an|the)?\s*(.+?)\s+(?:to|on|onto|at|in|into)\s+\S+/i)?.[1];
  const name = (quoted ?? phrase ?? LABEL[type]).trim();
  const fivePrime = /5['′]|five[- ]?prime|\b(?:start|beginning|front)\b/.test(lower);
  const bottom = /\bbottom\b/.test(lower);
  return { lower, remove, type, name, fivePrime, bottom };
}

/** human_message + patch_proposed (or an error event when nothing can be patched). */
/** `defaultTarget`: the state the reviewer pressed "modify" on, used when the sentence names none. */
export function offlinePropose(ui: UIState, text: string, seq: number, defaultTarget?: string | null): RunEvent[] {
  const run_id = ui.runId ?? "fixture";
  const events: RunEvent[] = [
    { run_id, seq, ts: now(), t: "human_message", text, mode: ui.status === "running" ? "during" : "after" },
  ];
  const target = pickTarget(ui, text, defaultTarget);
  if (!target) {
    return [...events, { run_id, seq: seq + 1, ts: now(), t: "error", message: "offline editor: no committed state to patch yet" }];
  }
  const { lower, remove, type, name, fivePrime, bottom } = parse(text);
  const strandKey = bottom ? "bottom" : "top";
  const strand = target.strands[strandKey];
  let after: MoleculeState;
  let op: string;
  let reason: string;
  if (remove) {
    const byName = strand.findIndex((s) => lower.includes(s.name.toLowerCase()));
    const byType = type !== "other" ? strand.findIndex((s) => s.type === type) : -1;
    const i = byName >= 0 ? byName : byType >= 0 ? byType : strand.length - 1;
    if (i < 0) {
      return [...events, { run_id, seq: seq + 1, ts: now(), t: "error", message: `offline editor: ${target.id} has no ${strandKey} segments to remove` }];
    }
    const gone = strand[i];
    after = { ...target, origin: "human", strands: { ...target.strands, [strandKey]: strand.filter((_, j) => j !== i) } };
    op = "remove_segment";
    reason = `Removed ${gone.name} (${gone.type}) from the ${strandKey} strand of ${target.id}, per “${text}”.`;
  } else {
    const seg: Segment = { name, type, origin: "human" };
    // top is listed 5'→3' (5' end = first); bottom is listed 3'→5' (5' end = last).
    const atStart = strandKey === "top" ? fivePrime : !fivePrime;
    after = { ...target, origin: "human", strands: { ...target.strands, [strandKey]: atStart ? [seg, ...strand] : [...strand, seg] } };
    op = "add_segment";
    reason = `Added ${name} (${type}) at the ${fivePrime ? "5′" : "3′"} end of the ${strandKey} strand of ${target.id}, per “${text}”.`;
  }
  events.push({
    run_id, seq: seq + 1, ts: now(), t: "patch_proposed",
    patch_id: `pp_${seq + 1}`, op, target: target.id, before: target, after, reason,
  });
  return events;
}

function downstream(ui: UIState, id: string): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of ui.edges) {
      if (e.source === cur && !seen.has(e.target)) {
        seen.add(e.target);
        out.push(e.target);
        queue.push(e.target);
      }
    }
  }
  return out;
}

/** state_revised + patch_applied, marking every downstream state stale (M8 semantics). */
export function offlineApply(ui: UIState, patch: Patch, seq: number): RunEvent[] {
  const run_id = ui.runId ?? "fixture";
  const before = patch.before ?? ui.nodes.find((n) => n.id === patch.target)?.data.state;
  if (!before) return [{ run_id, seq, ts: now(), t: "error", message: `offline editor: ${patch.target} not found` }];
  const revision = ui.workflowRevision + 1;
  const stale = downstream(ui, patch.target);
  const after: MoleculeState = { ...(patch.after ?? before), stale_since_revision: null };
  return [
    { run_id, seq, ts: now(), t: "state_revised", state_id: patch.target, before, after, caused_by: patch.patch_id, workflow_revision: revision, stale },
    { run_id, seq: seq + 1, ts: now(), t: "patch_applied", patch_id: patch.patch_id, workflow_revision: revision, stale },
  ];
}

/** What the backend's reviews.py would emit for a review (§5 steps 1–2, as events):
 *  review_recorded, plus state_revised for modify (after) / reject (after: null). */
export function offlineReview(ui: UIState, review: ReviewInput, reviewer: Reviewer, seq: number): { events: RunEvent[]; review_id: string } {
  const run_id = ui.runId ?? "fixture";
  const review_id = `rv_${seq}`;
  const events: RunEvent[] = [
    { run_id, seq, ts: now(), t: "review_recorded", review_id, target_id: review.target_id, decision: review.decision, reviewer, note: review.note },
  ];
  const node = ui.nodes.find((n) => n.id === review.target_id);
  if (node && (review.decision === "reject" || (review.decision === "modify" && review.after))) {
    const revision = ui.workflowRevision + 1;
    const stale = downstream(ui, review.target_id);
    const after = review.decision === "reject" ? null : { ...(review.after as MoleculeState), stale_since_revision: null };
    events.push({
      run_id, seq: seq + 1, ts: now(), t: "state_revised",
      state_id: review.target_id, before: node.data.state, after, caused_by: review_id, workflow_revision: revision, stale,
    });
  }
  return { events, review_id };
}
