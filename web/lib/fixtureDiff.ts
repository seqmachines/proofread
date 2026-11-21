// lib/fixtureDiff.ts — a ground-truth comparison for the synthetic benchmark fixture
// (/runs/fixture-benchmark), in the shape of GET /runs/{id}/gt-diff (§2.6). Hand-written,
// like the fixture itself: it keeps the comparison views working with no backend. It is
// built from the fixture's own states, so partial matches, an unmatched state and a missing
// ground-truth state are always present.
import type { GtDiff, MoleculeState, Segment } from "./events";
import type { UIState } from "./reducer";

const gt = (name: string, type: Segment["type"]): Segment => ({ name, type, origin: "source" });
const TSO = gt("TSO", "tso");
const TSO_RC = gt("TSO'", "tso");

export function fixtureGtDiff(fixture: string, ui: UIState): GtDiff | null {
  if (fixture !== "benchmark") return null;
  const state = new Map(ui.nodes.filter((n) => !n.data.ghost).map((n) => [n.id, n.data.state]));
  const [s1, s2, s3, s4, s5] = ["S1", "S2", "S3", "S4", "S5"].map((id) => state.get(id));
  if (!s1 || !s2 || !s3 || !s4 || !s5) return null;
  const truth = (of: MoleculeState, id: string, top: Segment[], bottom: Segment[]): MoleculeState => ({
    ...of, id, origin: "source", evidence: [], review_status: "unreviewed", strands: { top, bottom },
  });
  const fragmentation = ui.edges.map((e) => e.data?.transition).find((t) => t?.op === "fragmentation" && t.to === "S5");
  return {
    matched_states: [
      { predicted: s1, truth: truth(s1, "gt_mrna", s1.strands.top, s1.strands.bottom), similarity: 1 },
      { predicted: s2, truth: truth(s2, "gt_hybrid", s2.strands.top, s2.strands.bottom), similarity: 1 },
      // The template-switch oligo anneals to the untemplated CCC and is copied; the agent left it out.
      { predicted: s3, truth: truth(s3, "gt_switched", [TSO, ...s3.strands.top], [TSO_RC, ...s3.strands.bottom]), similarity: 0.71 },
      // Here the reference names the junction by the oligo alone, so the agent's CCC / GGG have no counterpart.
      { predicted: s4, truth: truth(s4, "gt_amplified", [...s4.strands.top.slice(0, -1), TSO_RC], [...s4.strands.bottom.slice(0, -1), TSO]), similarity: 0.88 },
    ],
    matched_transitions: [],
    extra_states: [s5],
    missing_states: [
      truth(s5, "gt_tagmented", [gt("Read 1", "handle"), gt("cell barcode", "barcode"), gt("UMI", "umi"), gt("poly(dT)VN", "primer"), gt("cDNA", "insert"), gt("Read 2", "adapter")], []),
    ].map((s) => ({ ...s, label: "tagmented cDNA with Read 2" })),
    missing_transitions: [
      { transition_id: "gt_tagmentation", operation: "tagmentation", substrate_state_ids: ["gt_amplified"], product_state_ids: ["gt_tagmented"], carried_forward_product_ids: ["gt_tagmented"], discarded_product_ids: [], oligo_ids: [] },
    ],
    extra_transitions: fragmentation ? [fragmentation] : [],
    missing_edges: [],
    extra_edges: [],
  };
}
