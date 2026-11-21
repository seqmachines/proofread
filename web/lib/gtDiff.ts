// lib/gtDiff.ts — what the ground-truth comparison says, in a form the views can draw.
// GET /runs/{id}/gt-diff (§2.6) matches whole states and gives each match one similarity.
// This adds which segments have no counterpart on the other side, and collects what was
// never matched at all. Display only: the similarity and the scores stay the backend's.
import type { GtDiff, GtTransition, MoleculeState, Segment, Transition } from "./events";
import { alignPairs, segmentKey, type SegmentKey } from "./strandAlign.ts";

/** Indices into strands.top / strands.bottom. */
export interface SegmentMarks {
  top: number[];
  bottom: number[];
}

export interface StateComparison {
  truth: MoleculeState; // as drawn: turned 180° when `flipped`
  similarity: number;
  flipped: boolean; // the ground truth lists the molecule the other way up
  extra: SegmentMarks; // the agent's segments with no ground-truth counterpart
  missing: SegmentMarks; // ground-truth segments (in `truth`) the agent's state lacks
}

export interface Comparison {
  matched: Map<string, StateComparison>; // by predicted state id
  unmatched: Set<string>; // predicted state ids with no ground-truth counterpart
  missingStates: MoleculeState[]; // ground-truth states the agent never produced
  missingTransitions: GtTransition[];
  extraTransitions: Transition[];
}

// Same role is a counterpart. So is the same type, unless both names are recognised and
// say different things: "10x BC" answers "cell barcode", but P5 does not answer P7.
const counterpart = (a: SegmentKey, b: SegmentKey) =>
  a.role !== "" && a.role === b.role ? 2 : a.type === b.type && a.type !== "other" && !(a.known && b.known) ? 1 : 0;

function strandDiff(agent: Segment[], truth: Segment[]) {
  const pairs = alignPairs(agent.map(segmentKey), truth.map(segmentKey), counterpart);
  const inAgent = new Set(pairs.map(([i]) => i));
  const inTruth = new Set(pairs.map(([, j]) => j));
  return {
    pairs: pairs.length,
    extra: agent.map((_, i) => i).filter((i) => !inAgent.has(i)),
    missing: truth.map((_, j) => j).filter((j) => !inTruth.has(j)),
  };
}

function against(agent: MoleculeState, truth: MoleculeState) {
  const top = strandDiff(agent.strands.top, truth.strands.top);
  const bottom = strandDiff(agent.strands.bottom, truth.strands.bottom);
  return { pairs: top.pairs + bottom.pairs, extra: { top: top.extra, bottom: bottom.extra }, missing: { top: top.missing, bottom: bottom.missing } };
}

// The same duplex seen from the other side: each strand becomes the other row, read the
// other way. The native structure describes the original rows, so it does not carry over.
const turned = (s: MoleculeState): MoleculeState => ({
  ...s,
  strands: { top: [...s.strands.bottom].reverse(), bottom: [...s.strands.top].reverse() },
  benchmark_structure: undefined,
});

/** Segment-level differences between an agent state and its matched ground-truth state. */
export function compareState(agent: MoleculeState, truth: MoleculeState, similarity: number): StateComparison {
  const straight = against(agent, truth);
  const other = turned(truth);
  const rotated = against(agent, other);
  // The scorer matches strands whichever is listed on top, so the better of the two views is the fair one.
  const flipped = rotated.pairs > straight.pairs;
  const best = flipped ? rotated : straight;
  return { truth: flipped ? other : truth, similarity, flipped, extra: best.extra, missing: best.missing };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const isState = (x: unknown): x is MoleculeState =>
  isObject(x) && typeof x.id === "string" && isObject(x.strands) && Array.isArray(x.strands.top) && Array.isArray(x.strands.bottom);
const isGtTransition = (x: unknown): x is GtTransition => isObject(x) && typeof x.transition_id === "string" && Array.isArray(x.substrate_state_ids);
const isTransition = (x: unknown): x is Transition => isObject(x) && typeof x.id === "string" && typeof x.from === "string" && typeof x.to === "string";

const ids = (list: unknown[] | undefined) =>
  (list ?? []).flatMap((x) => (typeof x === "string" ? [x] : isObject(x) && typeof x.id === "string" ? [x.id] : []));

// Legacy diffs carry no matched_states; there an extra edge names the states it touches.
const edgeEnds = (list: unknown[] | undefined) =>
  (list ?? []).flatMap((x) => (isObject(x) ? [x.from, x.to, x.source, x.target].filter((v): v is string => typeof v === "string") : []));

export function compareRun(diff: GtDiff): Comparison {
  const matched = new Map<string, StateComparison>();
  for (const m of diff.matched_states ?? []) {
    if (isState(m.predicted) && isState(m.truth)) matched.set(m.predicted.id, compareState(m.predicted, m.truth, m.similarity));
  }
  return {
    matched,
    unmatched: new Set([...ids(diff.extra_states), ...(diff.matched_states ? [] : edgeEnds(diff.extra_edges))]),
    missingStates: diff.missing_states.filter(isState),
    missingTransitions: (diff.missing_transitions ?? []).filter(isGtTransition),
    extraTransitions: (diff.extra_transitions ?? []).filter(isTransition),
  };
}

/** Names behind a set of marks, for tooltips and one-line summaries. */
export const markedNames = (state: MoleculeState, marks: SegmentMarks) =>
  (["top", "bottom"] as const).flatMap((row) => marks[row].flatMap((i) => (state.strands[row][i] ? [{ name: state.strands[row][i].name, row }] : [])));
