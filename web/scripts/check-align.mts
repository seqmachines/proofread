// Strands in register: paired segments share a drawing column (lib/strandAlign.ts).
// Ground-truth comparison: segments and states with no counterpart are named (lib/gtDiff.ts).
//   npm run check:align
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MoleculeState, Segment } from "../lib/events.ts";
import { fold, parseJsonl } from "../lib/reducer.ts";
import { alignStrands } from "../lib/strandAlign.ts";
import { compareRun, compareState, markedNames } from "../lib/gtDiff.ts";
import { fixtureGtDiff } from "../lib/fixtureDiff.ts";

const load = (name: string) => fold(parseJsonl(readFileSync(new URL(`../../fixtures/${name}.jsonl`, import.meta.url), "utf8")));
const picture = (s: Pick<MoleculeState, "strands" | "benchmark_structure">) =>
  alignStrands(s)
    .map((c) => `${c.top === null ? "–" : s.strands.top[c.top].name}/${c.bottom === null ? "–" : s.strands.bottom[c.bottom].name}`)
    .join(" ");

const benchmark = load("run_example_benchmark");
const stateOf = (id: string) => benchmark.nodes.find((n) => n.id === id)!.data.state;

// The state that was drawn shifted: a 3′ overhang on the bottom strand, left of the duplex.
assert.equal(picture(stateOf("S3")), "–/CCC mRNA/cDNA poly(A)/poly(dT)VN –/UMI –/10x BC –/Read 1");
// A trailing overhang, already right by index, stays as it was.
assert.equal(picture(stateOf("S2")), "mRNA/cDNA poly(A)/poly(dT)VN –/UMI –/10x BC –/Read 1");

// Every segment is drawn exactly once, in order, in every fixture state; equal-length
// strands keep their by-index layout.
for (const name of ["run_example", "run_example_benchmark", "run_example_loop"]) {
  for (const n of load(name).nodes) {
    const { top, bottom } = n.data.state.strands;
    const cols = alignStrands(n.data.state);
    const order = (row: "top" | "bottom") => cols.flatMap((c) => (c[row] === null ? [] : [c[row]]));
    assert.deepEqual(order("top"), top.map((_, i) => i), `${name} ${n.id} top`);
    assert.deepEqual(order("bottom"), bottom.map((_, i) => i), `${name} ${n.id} bottom`);
    if (top.length === bottom.length) assert.equal(cols.length, top.length, `${name} ${n.id} stays index-aligned`);
  }
}

// Nothing recognisable in common: fall back to the by-index layout.
const seg = (name: string, type: Segment["type"] = "other"): Segment => ({ name, type, origin: "llm" });
assert.equal(picture({ strands: { top: [seg("A", "adapter"), seg("B", "barcode")], bottom: [seg("X", "umi"), seg("Y", "index"), seg("Z", "primer")] } }), "A/X B/Y –/Z");

// Imported states: the native structure's paired_regions decide, not the names. The bottom
// row lists the partner strand in reverse, and unpaired segments get their own column.
const native = (ids: string[]) => ids.map((segment_id) => ({ segment_id, role: segment_id }));
const forked = {
  strands: { top: [seg("arm1"), seg("stem"), seg("body")], bottom: [seg("arm2"), seg("stem'"), seg("body'"), seg("tail")] },
  benchmark_structure: {
    state_id: "x", strand_architecture: "partially_duplex", reference_strand_id: "fwd",
    strands: [
      { strand_id: "fwd", molecule_type: "DNA", orientation: "5_to_3", segments: native(["f_arm", "f_stem", "f_body"]) },
      { strand_id: "rev", molecule_type: "DNA", orientation: "5_to_3", segments: native(["r_tail", "r_body", "r_stem", "r_arm"]) },
    ],
    paired_regions: [
      { relationship: "reverse_complementary", side_1: { strand_id: "fwd", segment_ids: ["f_stem", "f_body"] }, side_2: { strand_id: "rev", segment_ids: ["r_body", "r_stem"] } },
    ],
  },
};
assert.equal(picture(forked), "arm1/– –/arm2 stem/stem' body/body' –/tail");
// A structure the two rows do not resolve to is ignored rather than trusted.
assert.equal(picture({ ...forked, strands: { top: forked.strands.top.slice(1), bottom: forked.strands.bottom } }), "–/arm2 stem/stem' body/body' –/tail");

// ---------------------------------------------------------------- ground-truth comparison

const state = (top: Segment[], bottom: Segment[]): MoleculeState => ({
  id: "s", label: "s", strands: { top, bottom }, origin: "llm", evidence: [], skill_call_id: null, review_status: "unreviewed", stale_since_revision: null,
});
const names = (s: MoleculeState, marks: { top: number[]; bottom: number[] }) => markedNames(s, marks).map((m) => `${m.name} (${m.row})`);

// One segment left out in the middle is the only thing reported; what follows still matches.
const agent = state([seg("Read 1", "handle"), seg("10x BC", "barcode"), seg("cDNA", "insert")], []);
const reference = state([seg("Read 1", "handle"), seg("cell barcode", "barcode"), seg("UMI", "umi"), seg("mRNA-derived cDNA", "insert")], []);
let cmp = compareState(agent, reference, 0.8);
assert.deepEqual(names(cmp.truth, cmp.missing), ["UMI (top)"]); // "10x BC" answers "cell barcode"
assert.deepEqual(names(agent, cmp.extra), []);
assert.equal(cmp.flipped, false);

// Two recognised names that say different things are not counterparts, even with one type.
cmp = compareState(state([seg("P5", "adapter"), seg("cDNA", "insert")], []), state([seg("P7", "adapter"), seg("cDNA", "insert")], []), 0.7);
assert.deepEqual(names(cmp.truth, cmp.missing), ["P7 (top)"]);
assert.equal(cmp.extra.top.length, 1);

// The same duplex listed the other way up is turned before comparing.
const up = state([seg("P5", "adapter"), seg("cDNA", "insert"), seg("P7", "adapter")], [seg("P5'", "adapter"), seg("cDNA'", "insert"), seg("P7'", "adapter")]);
const down = state([seg("P7", "adapter"), seg("cDNA", "insert"), seg("P5", "adapter")], [seg("P7'", "adapter"), seg("cDNA'", "insert"), seg("P5'", "adapter")]);
cmp = compareState(up, down, 1);
assert.equal(cmp.flipped, true);
assert.deepEqual([cmp.extra, cmp.missing], [{ top: [], bottom: [] }, { top: [], bottom: [] }]);

// The benchmark fixture's comparison: what each view is expected to show.
const run = compareRun(fixtureGtDiff("benchmark", benchmark)!);
assert.deepEqual([...run.unmatched], ["S5"]);
assert.deepEqual(run.missingStates.map((s) => s.label), ["tagmented cDNA with Read 2"]);
const s3 = run.matched.get("S3")!;
assert.deepEqual(names(s3.truth, s3.missing), ["TSO (top)", "TSO' (bottom)"]);
assert.deepEqual(names(stateOf("S3"), s3.extra), []);
const s4 = run.matched.get("S4")!;
assert.deepEqual(names(stateOf("S4"), s4.extra), ["CCC (top)", "GGG (bottom)"]);
assert.deepEqual(names(s4.truth, s4.missing), ["TSO' (top)", "TSO (bottom)"]);
assert.deepEqual([run.missingTransitions.length, run.extraTransitions.length], [1, 1]);

console.log("check:align PASS");
