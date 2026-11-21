// lib/construction.ts — the agent trace read as "how was the workflow built?".
// Two groupings over fold(events), for display only; nothing here is stored.
//   constructionItems: inside one step, a committed transition and the product state it
//     made (with its skill call and any discarded by-products) become one construction
//     step, in transition order. Imported runs emit every state and then every
//     transition; this puts each product back next to the transition that made it.
//   foldQuiet: steps that only read and reason fold away once a step that changes the
//     workflow follows them.
// `change` is what a step's product has that its substrate did not. It uses the segment
// comparison of the ground-truth view (lib/gtDiff.ts), which matches by role and then by
// type, so a segment the agent only described in other words is not reported as new.
import type { MoleculeState, RunEvent, SkillCalledEvent, Transition } from "./events";
import { compareState, markedNames, type SegmentMarks } from "./gtDiff.ts";

/** Events that change the workflow or judge it. Reading and reasoning alone do not. */
export const WORKFLOW_EVENTS = new Set<RunEvent["t"]>([
  "state_committed",
  "transition_committed",
  "state_revised",
  "transition_revised",
  "skill_called",
  "verifier_check",
  "review_recorded",
]);

export interface Change {
  added: SegmentMarks; // the product's segments with no counterpart in the substrate
  removed: string[]; // names of the substrate's segments with no counterpart in the product
}

/** One step of building the workflow: a transition and what it made, or a state on its own. */
export interface Construction {
  seq: number; // the event it stands at: the transition's, or the state's when there is none
  transition: Transition | null; // null: a state committed without a transition in this step
  product: MoleculeState | null; // null when the transition's product was never committed
  substrate: MoleculeState | null;
  skill: SkillCalledEvent | null;
  change: Change | null; // needs both a substrate and a product
}

export type StepItem = { kind: "event"; event: RunEvent } | { kind: "construction"; step: Construction };

export function changeOf(product: MoleculeState, substrate: MoleculeState): Change {
  const cmp = compareState(product, substrate, 0);
  return { added: cmp.extra, removed: markedNames(cmp.truth, cmp.missing).map((m) => m.name) };
}

/**
 * One step's events with the construction steps put together. `stateOf` resolves any
 * state of the run (a substrate is usually committed in an earlier step); `skillOf` any
 * skill call. Every other event passes through in its place.
 */
export function constructionItems(
  events: RunEvent[],
  stateOf: (id: string) => MoleculeState | undefined,
  skillOf: (id: string) => SkillCalledEvent | undefined = () => undefined,
): StepItem[] {
  const commitSeq = new Map<string, number>(); // state id → its commit in this step
  const callSeq = new Map<string, number>(); // skill call id → its call in this step
  for (const e of events) {
    if (e.t === "state_committed" && !commitSeq.has(e.state.id)) commitSeq.set(e.state.id, e.seq);
    if (e.t === "skill_called") callSeq.set(e.skill_call_id, e.seq);
  }
  // Events shown inside a construction step instead of as rows of their own.
  const inside = new Set<number>();
  const take = (seq: number | undefined) => {
    if (seq !== undefined) inside.add(seq);
  };
  for (const e of events) {
    if (e.t !== "transition_committed") continue;
    for (const id of [e.transition.to, ...(e.transition.discarded ?? [])]) take(commitSeq.get(id));
    if (e.transition.skill_call_id) take(callSeq.get(e.transition.skill_call_id));
  }
  // A state left on its own still takes its skill call with it.
  for (const e of events) {
    if (e.t === "state_committed" && !inside.has(e.seq) && e.state.skill_call_id) take(callSeq.get(e.state.skill_call_id));
  }

  const items: StepItem[] = [];
  for (const e of events) {
    if (inside.has(e.seq)) continue;
    if (e.t === "transition_committed") {
      const t = e.transition;
      const product = stateOf(t.to) ?? null;
      const substrate = stateOf(t.from) ?? null;
      items.push({
        kind: "construction",
        step: {
          seq: e.seq,
          transition: t,
          product,
          substrate,
          skill: (t.skill_call_id && skillOf(t.skill_call_id)) || null,
          change: product && substrate ? changeOf(product, substrate) : null,
        },
      });
    } else if (e.t === "state_committed") {
      const skill = (e.state.skill_call_id && skillOf(e.state.skill_call_id)) || null;
      items.push({ kind: "construction", step: { seq: e.seq, transition: null, product: e.state, substrate: null, skill, change: null } });
    } else {
      items.push({ kind: "event", event: e });
    }
  }
  return items;
}

/**
 * Runs of steps that do not change the workflow, grouped so the view can fold them. The
 * run at the end stays as it is: that is where a live run is working, and all a run that
 * committed nothing has to show.
 */
export function foldQuiet<T>(steps: T[], changesWorkflow: (step: T) => boolean): ({ quiet: T[] } | { step: T })[] {
  const out: ({ quiet: T[] } | { step: T })[] = [];
  let run: T[] = [];
  for (const step of steps) {
    if (!changesWorkflow(step)) {
      run.push(step);
      continue;
    }
    if (run.length > 0) out.push({ quiet: run });
    run = [];
    out.push({ step });
  }
  return [...out, ...run.map((step) => ({ step }))];
}
