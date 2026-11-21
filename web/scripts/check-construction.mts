// The trace read as how the workflow was built (lib/construction.ts): each transition and
// the product it made are one construction step, and reading-only steps fold away.
//   npm run check:construction
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MoleculeState } from "../lib/events.ts";
import { fold, parseJsonl, type TraceStep } from "../lib/reducer.ts";
import { WORKFLOW_EVENTS, type StepItem, constructionItems, foldQuiet } from "../lib/construction.ts";
import { markedNames } from "../lib/gtDiff.ts";

function load(name: string) {
  const ui = fold(parseJsonl(readFileSync(new URL(`../../fixtures/${name}.jsonl`, import.meta.url), "utf8")));
  const committed = new Map<string, MoleculeState>();
  for (const st of ui.trace) for (const e of st.events) if (e.t === "state_committed" && !committed.has(e.state.id)) committed.set(e.state.id, e.state);
  const items = (st: TraceStep) => constructionItems(st.events, (id) => committed.get(id), (id) => ui.skillCalls[id]);
  return { ui, items, step: (n: number) => ui.trace.find((st) => st.step === n)! };
}
// "reverse_transcription S1>S2" for a construction step, the event type for anything else.
const say = (item: StepItem) =>
  item.kind === "event" ? item.event.t : `${item.step.transition?.op ?? "state"} ${item.step.substrate?.id ?? ""}>${item.step.product?.id ?? "?"}`;
const built = (items: StepItem[]) => items.flatMap((i) => (i.kind === "construction" ? [i.step] : []));

// A live step: the skill call, the product's commit and the transition are one step.
const loop = load("run_example_loop");
const rt = loop.items(loop.step(2));
assert.deepEqual(rt.map(say).filter((x) => x !== "checkpoint"), ["evidence_searched", "reverse_transcription S1>S2"]);
const [s2] = built(rt);
assert.equal(s2.skill?.skill_call_id, "sk_1");
assert.deepEqual(markedNames(s2.product!, s2.change!.added).map((m) => `${m.name} (${m.row})`), ["cDNA (bottom)", "poly(dT)VN (bottom)", "UMI (bottom)", "10x BC (bottom)", "Read 1 (bottom)"]);
assert.deepEqual(s2.change!.removed, []);
// The input material has no transition into it: a step of its own, with nothing to compare.
assert.deepEqual(built(loop.items(loop.step(1))).map((c) => [c.transition, c.product?.id, c.change]), [[null, "S1", null]]);
// A discarded by-product is committed like any state; it belongs to the transition that made it.
const frag = built(loop.items(loop.step(5)));
assert.deepEqual(frag.map((c) => [c.transition?.id, c.transition?.discarded]), [["T4", ["S5b"]]]);
assert.deepEqual([markedNames(frag[0].product!, frag[0].change!.added), frag[0].change!.removed], [[], ["CCC", "GGG"]]);

// An imported record lists every state, then every transition. Each product still ends up
// with the transition that made it, in transition order, and nothing is drawn twice.
const record = load("run_example_benchmark");
const all = record.items(record.ui.trace[0]);
assert.deepEqual(all.filter((i) => i.kind === "construction").map(say), [
  "state >S1",
  "reverse_transcription S1>S2",
  "template_switching S2>S3",
  "pcr S3>S4",
  "fragmentation S4>S5",
]);
assert.equal(all.some((i) => i.kind === "event" && (i.event.t === "state_committed" || i.event.t === "transition_committed")), false);

// Reading-only steps fold once a step that changes the workflow follows; the last run stays.
const changes = (st: TraceStep) => st.events.some((e) => WORKFLOW_EVENTS.has(e.t));
const shape = (trace: TraceStep[]) => foldQuiet(trace, changes).map((b) => ("quiet" in b ? b.quiet.map((st) => st.step) : b.step.step));
assert.deepEqual(shape(load("run_example").ui.trace), [[1], 2, 3, 4]);
assert.deepEqual(shape(loop.ui.trace), [1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(foldQuiet(["read", "read", "commit", "read"], (x) => x === "commit"), [{ quiet: ["read", "read"] }, { step: "commit" }, { step: "read" }]);

console.log("check:construction PASS");
