// lib/reducer.ts — UI state is always fold(events). Components never hold
// workflow state of their own; replay, live and reconnect all go through here.
//
// Node positions are assigned once when a node first appears — a ghost at
// skill_called or a real node at state_committed — and are never recomputed.
// The workflow flows top → bottom: y = depth·170, x = branch·300.
import type { Edge, Node } from "@xyflow/react";
import type {
  BenchmarkScore,
  CheckResult,
  EvidenceHit,
  GateResultEvent,
  GtScore,
  HarnessCandidateEvent,
  HarnessPatch,
  MoleculeState,
  ReviewFindingEvent,
  ReviewRecordedEvent,
  ReviewStatus,
  RunEvent,
  RunStatus,
  SkillCalledEvent,
  Transition,
} from "./events";

export const GRID_X = 300; // column spacing (branch)
export const GRID_Y = 170; // row spacing (depth)
export const positionOf = (depth: number, branch: number) => ({ x: branch * GRID_X, y: depth * GRID_Y });

export type MoleculeNodeData = {
  state: MoleculeState;
  ghost: boolean;     // produced by a skill, not yet committed
  stale: boolean;     // stale_since_revision != null
  discarded: boolean; // listed in a transition's `discarded` (product not carried forward)
  failed: number;     // failed verifier checks targeting this state
  findings: number;   // reviewer findings naming this state
  depth: number;
  branch: number;
  gtMismatch?: boolean; // view flag set by the canvas after "Compare with ground truth": no GT counterpart
  gtSimilarity?: number; // view flag: similarity of the matched GT state (0..1)
};
export type MoleculeNode = Node<MoleculeNodeData, "molecule">;

export type TransitionEdgeData = {
  transition: Transition;
  llm: boolean;     // skill_call_id null → LLM-constructed → dashed
  ordinal: number;  // 1-based commit order of the transition → "① reverse transcription"
  discard?: string; // set on the synthetic dashed edge substrate → discarded product (the discarded state id)
};
export type TransitionEdge = Edge<TransitionEdgeData, "transition">;

export interface TraceStep {
  step: number;
  goal: string;
  seq: number;
  ts: string;
  events: RunEvent[]; // everything emitted under this step, in seq order
}

export type PatchStatus = "proposed" | "applied";

export interface Patch {
  patch_id: string;
  op: string;
  target: string;
  before: MoleculeState | null;
  after: MoleculeState | null;
  reason: string;
  status: PatchStatus;
  seq: number;
  applied_revision: number | null;
  stale: string[];
}

export type ChatItem =
  | { kind: "human"; seq: number; ts: string; text: string; mode: "during" | "after" }
  | { kind: "patch"; seq: number; ts: string; patch_id: string };

export type HarnessVersionStatus = "active" | "gating" | "promoted" | "rejected" | "superseded";

/** One harness version as the run's events describe it (base version from run_started,
 *  candidates from harness_candidate, decisions from gate_result / harness_promoted). */
export interface HarnessVersionUI {
  id: string;
  parent: string | null;
  status: HarnessVersionStatus;
  patches: HarnessPatch[];
  candidate?: HarnessCandidateEvent;
  gate?: GateResultEvent;
}

export interface HarnessUI {
  versions: HarnessVersionUI[]; // in the order they appeared
  candidate?: HarnessCandidateEvent; // latest (kept for the status bar)
  gateResult?: GateResultEvent;
  promoted?: string;
}

function upsertVersion(
  versions: HarnessVersionUI[],
  id: string,
  fn: (v: HarnessVersionUI) => HarnessVersionUI,
  init: Partial<HarnessVersionUI> = {},
): HarnessVersionUI[] {
  const found = versions.some((v) => v.id === id);
  const base: HarnessVersionUI = { id, parent: null, status: "gating", patches: [], ...init };
  return found ? versions.map((v) => (v.id === id ? fn(v) : v)) : [...versions, fn(base)];
}

export interface UIState {
  runId: string | null;
  protocolId: string | null;
  status: RunStatus | "idle";
  step: number;
  harnessVersion: string | null;
  executor: string | null;      // run_started.executor (§2.2)
  source: string | null;        // run_started.source: live | harbor | benchmark
  workflowRevision: number;
  tokens: { lastCall: number; cumulative: number };
  nodes: MoleculeNode[];
  edges: TransitionEdge[];
  trace: TraceStep[];
  checks: CheckResult[];
  findings: ReviewFindingEvent[];
  reviews: ReviewRecordedEvent[]; // human decisions, append-only (§2.5)
  chat: ChatItem[];
  patches: Patch[];
  harness: HarnessUI;
  gtScore: GtScore | null;
  benchmarkScore: BenchmarkScore | null; // imported runs: saved benchmark metrics, never relabeled
  errors: { seq: number; message: string }[];
  lastSeq: number;
  skillCalls: Record<string, SkillCalledEvent>; // by skill_call_id
  chunks: Record<string, EvidenceHit>;          // every chunk the agent has seen, by chunk_id
}

export function initialState(): UIState {
  return {
    runId: null,
    protocolId: null,
    status: "idle",
    step: 0,
    harnessVersion: null,
    executor: null,
    source: null,
    workflowRevision: 0,
    tokens: { lastCall: 0, cumulative: 0 },
    nodes: [],
    edges: [],
    trace: [],
    checks: [],
    findings: [],
    reviews: [],
    chat: [],
    patches: [],
    harness: { versions: [] },
    gtScore: null,
    benchmarkScore: null,
    errors: [],
    lastSeq: 0,
    skillCalls: {},
    chunks: {},
  };
}

// ---------------------------------------------------------------- layout

const ghostId = (skillCallId: string) => `ghost:${skillCallId}`;

function slot(nodes: MoleculeNode[], parentId: string | null): { depth: number; branch: number } {
  const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;
  const depth = parent ? parent.data.depth + 1 : 0;
  let branch = parent ? parent.data.branch : 0;
  const taken = new Set(nodes.map((n) => `${n.data.depth}:${n.data.branch}`));
  while (taken.has(`${depth}:${branch}`)) branch += 1;
  return { depth, branch };
}

function makeNode(
  id: string,
  state: MoleculeState,
  parentId: string | null,
  nodes: MoleculeNode[],
  ghost: boolean,
): MoleculeNode {
  const { depth, branch } = slot(nodes, parentId);
  return {
    id,
    type: "molecule",
    position: positionOf(depth, branch),
    data: { state, ghost, stale: state.stale_since_revision !== null, discarded: false, failed: 0, findings: 0, depth, branch },
  };
}

// Parent heuristic for LLM-built states (no substrate on the event): the newest
// committed node on the main line — ghosts and discarded by-products don't count.
function lastCommitted(nodes: MoleculeNode[]): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (!nodes[i].data.ghost && !nodes[i].data.discarded) return nodes[i].id;
  }
  return null;
}

// A transition's `discarded` products sit one column right of the carried-forward
// product, at its depth, at 40% opacity. This is the one deliberate exception to
// "positions are never recomputed": it moves only the by-products (and pulls the kept
// product back to the main column if a by-product had taken it first), once, the
// moment the transition lands.
function placeDiscarded(nodes: MoleculeNode[], keptId: string, ids: string[]): MoleculeNode[] {
  const discard = new Set(ids);
  const kept = nodes.find((n) => n.id === keptId);
  if (!kept) return nodes.map((n) => (discard.has(n.id) ? { ...n, data: { ...n.data, discarded: true } } : n));
  const depth = kept.data.depth;
  const sameDepth = nodes.filter((n) => discard.has(n.id) && n.data.depth === depth).map((n) => n.data.branch);
  const mainBranch = Math.min(kept.data.branch, ...sameDepth);
  const taken = new Set(
    nodes.filter((n) => n.id !== keptId && !discard.has(n.id)).map((n) => `${n.data.depth}:${n.data.branch}`),
  );
  taken.add(`${depth}:${mainBranch}`);
  const target = new Map<string, number>([[keptId, mainBranch]]);
  let b = mainBranch;
  for (const id of ids) {
    if (!nodes.some((n) => n.id === id)) continue;
    do b += 1;
    while (taken.has(`${depth}:${b}`));
    taken.add(`${depth}:${b}`);
    target.set(id, b);
  }
  return nodes.map((n) => {
    const branch = target.get(n.id);
    if (branch === undefined) return n;
    const discarded = n.id !== keptId;
    if (n.data.depth === depth && n.data.branch === branch && n.data.discarded === discarded) return n;
    return { ...n, position: positionOf(depth, branch), data: { ...n.data, depth, branch, discarded } };
  });
}

function patchNode(
  nodes: MoleculeNode[],
  id: string,
  fn: (n: MoleculeNode) => MoleculeNode,
): MoleculeNode[] {
  return nodes.map((n) => (n.id === id ? fn(n) : n));
}

function markStale(nodes: MoleculeNode[], ids: string[], revision: number): MoleculeNode[] {
  if (ids.length === 0) return nodes;
  const set = new Set(ids);
  return nodes.map((n) =>
    set.has(n.id)
      ? {
          ...n,
          data: {
            ...n.data,
            stale: true,
            state: { ...n.data.state, stale_since_revision: n.data.state.stale_since_revision ?? revision },
          },
        }
      : n,
  );
}

// §5: a discarded product gets its own dashed, unlabeled edge from the substrate,
// once its node exists. Edge id = "<transition id>:discard:<state id>".
const discardEdgeId = (trId: string, stateId: string) => `${trId}:discard:${stateId}`;

function discardEdgesFor(tr: Transition, nodes: MoleculeNode[], existing: TransitionEdge[]): TransitionEdge[] {
  const ordinal = existing.find((x) => x.id === tr.id)?.data?.ordinal ?? 0;
  return (tr.discarded ?? [])
    .filter((id) => nodes.some((n) => n.id === id) && !existing.some((x) => x.id === discardEdgeId(tr.id, id)))
    .map((id) => ({
      id: discardEdgeId(tr.id, id),
      type: "transition" as const,
      source: tr.from,
      target: id,
      data: { transition: tr, llm: tr.skill_call_id === null, ordinal, discard: id },
    }));
}

// ---------------------------------------------------------------- trace

// Imported records (§4) have no step_started: their commits, checks, scores and reviews
// go under one synthetic card, step 0.
const RECORD_GOAL = "Imported record — commits, verifier checks and saved scores; no agent trace.";

function traced(trace: TraceStep[], e: RunEvent): TraceStep[] {
  if (e.t === "run_started") return trace;
  if (e.t === "step_started") {
    return [...trace, { step: e.step, goal: e.goal, seq: e.seq, ts: e.ts, events: [] }];
  }
  if (trace.length === 0) return [{ step: 0, goal: RECORD_GOAL, seq: e.seq, ts: e.ts, events: [e] }];
  const last = trace[trace.length - 1];
  return [...trace.slice(0, -1), { ...last, events: [...last.events, e] }];
}

// ---------------------------------------------------------------- reduce / fold

export function reduce(prev: UIState, e: RunEvent): UIState {
  if (e.seq <= prev.lastSeq) return prev; // duplicate (reconnect replay)
  const s: UIState = { ...prev, lastSeq: e.seq, trace: traced(prev.trace, e) };

  switch (e.t) {
    case "run_started":
      return {
        ...s,
        runId: e.run_id,
        protocolId: e.protocol_id,
        harnessVersion: e.harness_version,
        executor: e.executor ?? null,
        source: e.source ?? null,
        status: "running",
        workflowRevision: 1, // the workflow doc is created at revision 1 (§2.1)
        harness: {
          ...s.harness,
          versions: upsertVersion(s.harness.versions, e.harness_version, (v) => v, { status: "active" }),
        },
      };

    case "step_started":
      return { ...s, step: e.step };

    case "skill_called": {
      const skillCalls = { ...s.skillCalls, [e.skill_call_id]: e };
      const id = ghostId(e.skill_call_id);
      if (!e.result || s.nodes.some((n) => n.id === id)) return { ...s, skillCalls };
      const ghost = makeNode(id, e.result, e.inputs.substrate_id, s.nodes, true);
      return { ...s, skillCalls, nodes: [...s.nodes, ghost] };
    }

    case "state_committed": {
      const st = e.state;
      let nodes: MoleculeNode[];
      const idx = s.nodes.findIndex((n) => n.id === st.id);
      const gIdx = st.skill_call_id ? s.nodes.findIndex((n) => n.id === ghostId(st.skill_call_id!)) : -1;
      if (idx >= 0) {
        // re-commit of a known state: keep position
        nodes = patchNode(s.nodes, st.id, (n) => ({
          ...n,
          data: { ...n.data, state: st, ghost: false, stale: st.stale_since_revision !== null },
        }));
      } else if (gIdx >= 0) {
        // the committed state replaces its ghost, inheriting the ghost's slot
        nodes = s.nodes.map((n, i) =>
          i === gIdx
            ? { ...n, id: st.id, data: { ...n.data, state: st, ghost: false, stale: st.stale_since_revision !== null } }
            : n,
        );
      } else {
        const parent = st.skill_call_id
          ? (s.skillCalls[st.skill_call_id]?.inputs.substrate_id ?? lastCommitted(s.nodes))
          : lastCommitted(s.nodes);
        nodes = [...s.nodes, makeNode(st.id, st, parent, s.nodes, false)];
      }
      // A by-product committed after its transition still lands below the kept product,
      // and gets its dashed edge now that its node exists.
      const discardedBy = s.edges.find((x) => x.data?.transition.discarded?.includes(st.id))?.data?.transition;
      let edges = s.edges;
      if (discardedBy) {
        nodes = placeDiscarded(nodes, discardedBy.to, [st.id]);
        edges = [...edges, ...discardEdgesFor(discardedBy, nodes, edges)];
      }
      return { ...s, nodes, edges, workflowRevision: e.workflow_revision };
    }

    case "transition_committed": {
      const tr = e.transition;
      const prior = s.edges.find((x) => x.id === tr.id);
      const ordinal = prior?.data?.ordinal ?? s.edges.filter((x) => !x.data?.discard).length + 1;
      const edge: TransitionEdge = {
        id: tr.id,
        type: "transition",
        source: tr.from,
        target: tr.to,
        label: tr.op,
        data: { transition: tr, llm: tr.skill_call_id === null, ordinal },
      };
      let edges = s.edges.some((x) => x.id === tr.id)
        ? s.edges.map((x) => (x.id === tr.id ? edge : x))
        : [...s.edges, edge];
      const nodes = tr.discarded?.length ? placeDiscarded(s.nodes, tr.to, tr.discarded) : s.nodes;
      if (tr.discarded?.length) edges = [...edges, ...discardEdgesFor(tr, nodes, edges)];
      return { ...s, nodes, edges, workflowRevision: e.workflow_revision };
    }

    case "state_revised": {
      if (e.after === null) {
        // removed (reject): drop the node and every edge touching it; downstream goes stale
        const nodes = markStale(
          s.nodes.filter((n) => n.id !== e.state_id),
          e.stale,
          e.workflow_revision,
        );
        const edges = s.edges.filter((x) => x.source !== e.state_id && x.target !== e.state_id);
        return { ...s, nodes, edges, workflowRevision: e.workflow_revision };
      }
      const after = e.after;
      let nodes = patchNode(s.nodes, e.state_id, (n) => ({
        ...n,
        data: {
          ...n.data,
          // review_status is human-owned (review_recorded); a revision only changes it when it says so.
          state: {
            ...after,
            review_status: after.review_status !== e.before.review_status ? after.review_status : n.data.state.review_status,
          },
          stale: after.stale_since_revision !== null,
        },
      }));
      nodes = markStale(nodes, e.stale, e.workflow_revision);
      return { ...s, nodes, workflowRevision: e.workflow_revision };
    }

    case "transition_revised": {
      if (e.after === null) {
        return { ...s, edges: s.edges.filter((x) => x.id !== e.transition_id && x.data?.transition.id !== e.transition_id), workflowRevision: e.workflow_revision };
      }
      const tr = e.after;
      const prior = s.edges.find((x) => x.id === tr.id);
      const ordinal = prior?.data?.ordinal ?? s.edges.filter((x) => !x.data?.discard).length + 1;
      const edge: TransitionEdge = {
        id: tr.id,
        type: "transition",
        source: tr.from,
        target: tr.to,
        label: tr.op,
        data: { transition: tr, llm: tr.skill_call_id === null, ordinal },
      };
      const edges = prior ? s.edges.map((x) => (x.id === tr.id ? edge : x)) : [...s.edges, edge];
      return { ...s, edges, workflowRevision: e.workflow_revision };
    }

    case "review_recorded": {
      const status: Record<ReviewRecordedEvent["decision"], ReviewStatus> = {
        accept: "accepted",
        modify: "modified",
        reject: "rejected",
        unresolved: "unresolved",
      };
      const nodes = patchNode(s.nodes, e.target_id, (n) => ({
        ...n,
        data: { ...n.data, state: { ...n.data.state, review_status: status[e.decision] } },
      }));
      return { ...s, nodes, reviews: [...s.reviews, e] };
    }

    case "checkpoint":
      return { ...s, tokens: { lastCall: e.tokens.last_call, cumulative: e.tokens.cumulative } };

    case "verifier_check": {
      const check: CheckResult = {
        check: e.check,
        status: e.status,
        state_id: e.state_id ?? null,
        message: e.message,
        evidence: e.evidence ?? [],
      };
      const nodes =
        e.status === "fail" && e.state_id
          ? patchNode(s.nodes, e.state_id, (n) => ({ ...n, data: { ...n.data, failed: n.data.failed + 1 } }))
          : s.nodes;
      return {
        ...s,
        nodes,
        checks: [...s.checks, check],
        status: s.status === "running" ? "reviewing" : s.status,
      };
    }

    case "gt_scored":
      return { ...s, gtScore: { structure_f1: e.structure_f1, edge_f1: e.edge_f1 } };

    case "benchmark_scored":
      return { ...s, benchmarkScore: { benchmark_version: e.benchmark_version, metrics: e.metrics } };

    case "review_finding": {
      // A model finding is a proposal (§8.3): count it on the node; review_status stays human-owned.
      const nodes = e.state_id
        ? patchNode(s.nodes, e.state_id, (n) => ({ ...n, data: { ...n.data, findings: n.data.findings + 1 } }))
        : s.nodes;
      return { ...s, nodes, findings: [...s.findings, e] };
    }

    case "human_message":
      return { ...s, chat: [...s.chat, { kind: "human", seq: e.seq, ts: e.ts, text: e.text, mode: e.mode }] };

    case "patch_proposed": {
      const patch: Patch = {
        patch_id: e.patch_id,
        op: e.op,
        target: e.target,
        before: e.before,
        after: e.after,
        reason: e.reason,
        status: "proposed",
        seq: e.seq,
        applied_revision: null,
        stale: [],
      };
      return {
        ...s,
        patches: [...s.patches, patch],
        chat: [...s.chat, { kind: "patch", seq: e.seq, ts: e.ts, patch_id: e.patch_id }],
      };
    }

    case "patch_applied": {
      const patches = s.patches.map((p) =>
        p.patch_id === e.patch_id
          ? { ...p, status: "applied" as const, applied_revision: e.workflow_revision, stale: e.stale }
          : p,
      );
      return {
        ...s,
        patches,
        nodes: markStale(s.nodes, e.stale, e.workflow_revision),
        workflowRevision: e.workflow_revision,
      };
    }

    case "harness_candidate":
      return {
        ...s,
        harness: {
          ...s.harness,
          candidate: e,
          versions: upsertVersion(s.harness.versions, e.version, (v) => ({
            ...v,
            parent: e.parent,
            status: "gating",
            patches: e.patches,
            candidate: e,
          })),
        },
      };

    case "gate_result":
      return {
        ...s,
        harness: {
          ...s.harness,
          gateResult: e,
          versions: upsertVersion(s.harness.versions, e.version, (v) => ({
            ...v,
            status: e.decision === "promote" ? "promoted" : "rejected",
            gate: e,
          })),
        },
      };

    case "harness_promoted":
      return {
        ...s,
        harness: {
          ...s.harness,
          promoted: e.version,
          versions: upsertVersion(
            s.harness.versions.map((v) => (v.status === "active" ? { ...v, status: "superseded" as const } : v)),
            e.version,
            (v) => ({ ...v, status: "active" }),
          ),
        },
      };

    case "paused":
      return { ...s, status: "paused" };

    case "resumed":
      return { ...s, status: "running" };

    case "run_finished":
      return { ...s, status: e.status };

    case "error":
      return { ...s, errors: [...s.errors, { seq: e.seq, message: e.message }] };

    case "evidence_searched": {
      if (e.results.length === 0) return s;
      const chunks = { ...s.chunks };
      for (const r of e.results) chunks[r.chunk_id] = r;
      return { ...s, chunks };
    }

    case "assumption":
    case "guardrail_blocked":
      return s; // trace only
  }
}

/** Fold an ordered event list into UI state. Pass `from` to continue from a live state. */
export function fold(events: RunEvent[], from: UIState = initialState()): UIState {
  return events.reduce(reduce, from);
}

/** Parse one-event-per-line JSONL (the fixture and the poll fallback both use it). */
export function parseJsonl(text: string): RunEvent[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as RunEvent);
}
