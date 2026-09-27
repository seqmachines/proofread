// lib/events.ts — mirrors SPEC.md §2 exactly: §2.1 molecules, §2.2 events,
// §2.3 harness version, §2.4 signal, §2.5 review, plus the §2.6 response shapes.
// This module is types only; nothing here exists at runtime.

// ---------------------------------------------------------------- §2.1 Molecules

export type SegmentType =
  | "adapter" | "barcode" | "umi" | "insert" | "primer"
  | "tso" | "handle" | "index" | "polyA" | "other";

export type Origin = "source" | "skill" | "memory" | "llm" | "human";

export interface Segment {
  name: string;
  type: SegmentType;
  origin: Origin;
}

export type ReviewStatus = "unreviewed" | "accepted" | "modified" | "rejected" | "unresolved";

// Imported (benchmark) states may keep the native Task 3 structure, projected to
// symbolic segments: no sequences, no free text. strands.top/bottom are then only a
// preview of the reference strand and one partner; the UI must say more strands exist.
export interface BenchmarkSegment {
  segment_id: string;
  role: string;
  structural_role?: string;
  support_status?: string;
}
export interface BenchmarkStrand {
  strand_id: string;
  molecule_type: string;
  orientation: string;
  segments: BenchmarkSegment[];
}
export interface BenchmarkStructure {
  state_id: string;
  strand_architecture: string;
  reference_strand_id: string;
  strands: BenchmarkStrand[];
  paired_regions?: unknown[];
  discontinuities?: unknown[];
}

export interface MoleculeState {
  id: string;
  label: string;
  strands: {
    top: Segment[];    // listed 5'→3'
    bottom: Segment[]; // listed 3'→5', aligned under top; [] if single-stranded
  };
  origin: Origin;
  evidence: string[];             // chunk ids
  skill_call_id: string | null;   // null unless origin == skill
  review_status: ReviewStatus;
  stale_since_revision: number | null;
  benchmark_structure?: BenchmarkStructure; // imported states only
}

/** Saved benchmark metrics under their original names; t3_state_f1 is not structure_f1. */
export interface BenchmarkScore {
  benchmark_version: string;
  metrics: Record<string, number>; // t2_required_family_f1, t3_molecular_transition_f1, t3_state_f1, t3_typed_edge_f1, …
}

export type TransitionOp =
  | "reverse_transcription" | "template_switching" | "pcr"
  | "fragmentation" | "ligation" | "tagmentation" | "other";

export interface Transition {
  id: string;
  from: string;
  to: string;
  op: TransitionOp;
  skill_call_id: string | null;   // null if constructed by LLM
  evidence: string[];
  oligos?: string[];              // linked oligo names (Task 2 link); optional
  discarded?: string[];           // product state ids not carried forward; optional
}

export type CheckStatus = "pass" | "fail";

export interface CheckResult {
  check: string;
  status: CheckStatus;
  state_id?: string | null;
  message: string;
  evidence?: string[];
}

export interface GtScore {
  structure_f1: number; // soft match over architecture / ordered segments / pairing (§4 M4)
  edge_f1: number;      // over substrate / carried / discarded typed edges
}

export interface Workflow {
  run_id: string;
  protocol_id: string;
  harness_version: string;
  workflow_revision: number;
  states: MoleculeState[];
  transitions: Transition[];
  checks: CheckResult[];
  gt_score: GtScore | null;
  benchmark_score?: BenchmarkScore | null; // absent or null for live runs
}

// ---------------------------------------------------------------- §2.3 Harness

export type HarnessStatus = "active" | "candidate" | "promoted" | "rejected" | "superseded";
export type ToolAccess = "off" | "available" | "mandatory";
export type HistoryPolicy = "state_only" | "full";
export type HarnessPatchType = "tool_access" | "context_policy" | "guardrail" | "rule";

export interface HarnessPatch {
  type: HarnessPatchType;
  path: string;        // e.g. "tool_access.template_switch"
  from: unknown;
  to: unknown;
  reason: string;
  scope?: string;      // required for type=rule: the operation it applies to; workflow-wide rules are rejected
}

export interface ContextPolicy {
  evidence_k: number;
  history: HistoryPolicy; // enforced by ApiLoopExecutor only
  include_linked_oligos?: boolean;
}

export type GateRole = "target" | "regression";
export type GateDecision = "promote" | "reject";

export interface GateProtocolResult {
  protocol_id: string;
  role: GateRole;
  before: number;
  after: number;
  delta: number;
}

export interface HarnessEval {
  target: GateProtocolResult;
  regression: GateProtocolResult[];
  decision: GateDecision;
  reason: string;
}

export interface HarnessVersion {
  _id: string;
  parent_id: string | null;
  status: HarnessStatus;
  rules: string[];
  context_policy: ContextPolicy;
  guardrails: string[];
  tool_access: Record<string, ToolAccess>; // reverse_transcribe, template_switch
  patches: HarnessPatch[];
  source_signals: string[];
  eval: HarnessEval | null;
  created_at: string;
}

// ---------------------------------------------------------------- §2.4 Signal

export type SignalSource = "verifier" | "reviewer" | "human";
export type HarnessRelevance = "high" | "low";
// Paper Table S1 categories, exact benchmark schema slugs (§2.4).
export type ErrorType =
  | "missing_recoverable_information"
  | "unsupported_completion"
  | "operation_error"
  | "strand_or_orientation_error"
  | "molecular_state_or_assembly_error"
  | "workflow_or_topology_error";

export interface Signal {
  _id: string;
  run_id: string;
  protocol_id: string;
  harness_version: string;
  source: SignalSource;
  signature: string;      // error_type×operation, e.g. "molecular_state_or_assembly_error×template_switching"
  error_type: ErrorType;
  operation: TransitionOp;
  state_id: string | null;
  evidence: string[];
  root_cause: string;
  recommended_action: string;
  harness_relevance: HarnessRelevance;
  systematic: boolean;
  proposed_patch: HarnessPatch | null;
  review_id: string | null;
  processed: boolean;
  created_at: string;
}

// ---------------------------------------------------------------- §2.5 Review

export type ReviewDecision = "accept" | "modify" | "reject" | "unresolved";
export type ReviewerRole = "curator" | "author";

export interface Reviewer {
  id: string;
  name?: string;
  role: ReviewerRole;
}

/** Append-only: a later review of the same target is a new document. */
export interface Review {
  _id: string;
  run_id: string;
  workflow_revision: number;
  target_id: string; // state or transition id
  decision: ReviewDecision;
  before: MoleculeState | Transition | Record<string, unknown>;
  after?: MoleculeState | Transition | Record<string, unknown> | null; // present for modify; null for reject
  error_type: ErrorType | null; // §2.4 slug; required for modify/reject, null otherwise (reviewer's choice)
  note: string;
  reviewer: Reviewer;
  systematic: boolean;
  created_at: string;
}

/** POST body: Review minus id / created_at / reviewer — the reviewer comes from X-Review-Token. */
export type ReviewInput = Omit<Review, "_id" | "created_at" | "reviewer">;

export const ERROR_TYPES: ErrorType[] = [
  "missing_recoverable_information",
  "unsupported_completion",
  "operation_error",
  "strand_or_orientation_error",
  "molecular_state_or_assembly_error",
  "workflow_or_topology_error",
];

export interface ReviewResponse {
  review_id: string;
  workflow_revision: number;
  derived: { signal_id?: string; memory_candidate_id?: string; gt_candidate_id?: string };
}

// ---------------------------------------------------------------- §2.6 API shapes

export type RunStatus = "running" | "paused" | "reviewing" | "done" | "failed";
export type ProtocolRole = "dev" | "regression" | "transfer";

export type RunSource = "live" | "harbor" | "benchmark";

/** One system with a result for a protocol (§2.6 GET /protocols): the run to open. */
export interface ProtocolSource {
  run_id: string;
  source: RunSource | string;
  executor: string;
  model: string;
  harness_version: string;
  benchmark_score?: BenchmarkScore | null;
}

export interface Protocol {
  id: string;
  name: string;
  family: string;
  role: ProtocolRole;
  has_gt: boolean;
  sources?: ProtocolSource[];
}

/** GET /config */
export interface AppConfig {
  executor: string; // codex | claude | gemini | api | none
  live_runs: boolean;
  stream_mode: string; // stream | poll
}

/** One row of GET /benchmark. §2.6 only says "aggregated scores", so every field is optional
 *  and the page renders what is present. Fixture rows are built with the same shape. */
export interface BenchmarkRow {
  run_id?: string;
  run_ids?: string[];
  protocol?: string;
  executor?: string;
  harness_version?: string;
  source?: RunSource | "fixture" | string;
  runs?: number;
  gt_scored_runs?: number; // how many of the runs have a proofread gt_score
  structure_f1?: number | null; // proofread's own score (gt_scored)
  edge_f1?: number | null;
  benchmark?: BenchmarkScore | null; // saved benchmark metrics, original names
}

/** cDNA memory entity (§3 `entities`), as GET /memory returns it (verified only). */
export interface Entity {
  _id?: string;
  memory_key?: string;
  name: string;
  type: string; // usually a SegmentType
  sequence?: string;
  aliases?: string[];
  operation?: string;
  substrate?: string;
  assay_family?: string;
  verified: boolean;
  provenance: { review_id?: string; run_id?: string; [k: string]: unknown };
  protocol_id?: string; // set by reviews.py; the creating review lives on one of this protocol's runs
  decision?: string;
  created_at: string;
}

export interface QueueItem {
  run_id: string;
  protocol: string;
  executor: string;
  harness_version: string;
  unreviewed_failed_checks: number;
  unresolved: number;
  score: number | null;
}

export interface Run {
  run_id: string;
  protocol_id: string;
  harness_version: string;
  status: RunStatus;
  step: number;
  checkpoint?: Record<string, unknown>;
  tokens: TokenUsage;
  inbox?: unknown[];
  created_at: string;
}

export interface Chunk {
  chunk_id: string;
  protocol_id: string;
  page: number;
  text: string;
}

// Element shape is not pinned by §2.5; the web renders entries with fmtVal and matches ids loosely.
export interface GtDiff {
  missing_states: unknown[];
  extra_states: unknown[];
  missing_edges: unknown[];
  extra_edges: unknown[];
}

// ---------------------------------------------------------------- §2.2 Events

export interface EventBase {
  run_id: string;
  seq: number;   // per-run, strictly increasing from 1
  ts: string;
}

export interface EvidenceHit {
  chunk_id: string;
  page: number;
  snippet: string;
}

export interface TokenUsage {
  last_call: number;
  cumulative: number;
}

export type RunStartedEvent = EventBase & {
  t: "run_started";
  protocol_id: string;
  harness_version: string;
  executor?: string;
  source?: RunSource;
};
export type StepStartedEvent = EventBase & { t: "step_started"; step: number; goal: string };
export type EvidenceSearchedEvent = EventBase & { t: "evidence_searched"; query: string; results: EvidenceHit[] };
export type SkillCalledEvent = EventBase & {
  t: "skill_called";
  skill_call_id: string;
  skill: string;
  inputs: { substrate_id: string; oligo: string };
  result: MoleculeState | null;
  error: string | null;
};
export type StateCommittedEvent = EventBase & { t: "state_committed"; state: MoleculeState; workflow_revision: number };
export type TransitionCommittedEvent = EventBase & { t: "transition_committed"; transition: Transition; workflow_revision: number };
export type StateRevisedEvent = EventBase & {
  t: "state_revised";
  state_id: string;
  before: MoleculeState;
  after: MoleculeState | null; // null = removed (reject)
  caused_by: string;
  workflow_revision: number;
  stale: string[];
};
export type TransitionRevisedEvent = EventBase & {
  t: "transition_revised";
  transition_id: string;
  before: Transition | null; // null = added
  after: Transition | null; // null = removed
  caused_by: string;
  workflow_revision: number;
};
export type ReviewRecordedEvent = EventBase & {
  t: "review_recorded";
  review_id: string;
  target_id: string;
  decision: ReviewDecision;
  reviewer: Reviewer;
  note: string;
};
export type AssumptionEvent = EventBase & { t: "assumption"; text: string; state_id?: string | null };
export type GuardrailBlockedEvent = EventBase & { t: "guardrail_blocked"; tool: string; reason: string };
export type CheckpointEvent = EventBase & {
  t: "checkpoint";
  completed_states: string[];
  pending: string[];
  tokens: TokenUsage;
};
export type VerifierCheckEvent = EventBase & {
  t: "verifier_check";
  check: string;
  status: CheckStatus;
  state_id?: string | null;
  message: string;
  evidence?: string[];
};
export type GtScoredEvent = EventBase & { t: "gt_scored"; structure_f1: number; edge_f1: number };
export type BenchmarkScoredEvent = EventBase & { t: "benchmark_scored"; benchmark_version: string; metrics: Record<string, number> };
export type ReviewFindingEvent = EventBase & {
  t: "review_finding";
  signal_id: string;
  finding: string;
  operation: TransitionOp;
  state_id: string | null;
  root_cause: string;
  recommended_action: string;
  harness_relevance: HarnessRelevance;
};
export type HumanMessageEvent = EventBase & { t: "human_message"; text: string; mode: "during" | "after" };
export type PatchProposedEvent = EventBase & {
  t: "patch_proposed";
  patch_id: string;
  op: string;
  target: string;
  before: MoleculeState | null;
  after: MoleculeState | null;
  reason: string;
};
export type PatchAppliedEvent = EventBase & { t: "patch_applied"; patch_id: string; workflow_revision: number; stale: string[] };
export type HarnessCandidateEvent = EventBase & { t: "harness_candidate"; version: string; parent: string; patches: HarnessPatch[] };
export type GateResultEvent = EventBase & {
  t: "gate_result";
  version: string;
  sigma?: number; // spread of the active version's replicate runs on the target protocol
  results: GateProtocolResult[];
  decision: GateDecision;
  reason: string;
};
export type HarnessPromotedEvent = EventBase & { t: "harness_promoted"; version: string };
export type PausedEvent = EventBase & { t: "paused" };
export type ResumedEvent = EventBase & { t: "resumed" };
export type RunFinishedEvent = EventBase & { t: "run_finished"; status: "done" | "failed" };
export type ErrorEvent = EventBase & { t: "error"; message: string };

export type RunEvent =
  | RunStartedEvent
  | StepStartedEvent
  | EvidenceSearchedEvent
  | SkillCalledEvent
  | StateCommittedEvent
  | TransitionCommittedEvent
  | StateRevisedEvent
  | TransitionRevisedEvent
  | ReviewRecordedEvent
  | AssumptionEvent
  | GuardrailBlockedEvent
  | CheckpointEvent
  | VerifierCheckEvent
  | GtScoredEvent
  | BenchmarkScoredEvent
  | ReviewFindingEvent
  | HumanMessageEvent
  | PatchProposedEvent
  | PatchAppliedEvent
  | HarnessCandidateEvent
  | GateResultEvent
  | HarnessPromotedEvent
  | PausedEvent
  | ResumedEvent
  | RunFinishedEvent
  | ErrorEvent;

export type EventType = RunEvent["t"];
export type EventOf<T extends EventType> = Extract<RunEvent, { t: T }>;
