import type { RunEvent } from "./events";

/** One-line summary of an event, for the playback readout and compact trace rows. */
export function eventSummary(e: RunEvent): string {
  switch (e.t) {
    case "run_started":
      return `run_started ${e.protocol_id} on ${e.harness_version}`;
    case "step_started":
      return `step ${e.step} — ${e.goal}`;
    case "evidence_searched":
      return `evidence “${e.query}” → ${e.results.map((r) => r.chunk_id).join(", ")}`;
    case "skill_called":
      return `skill ${e.skill}(${e.inputs.substrate_id}, ${e.inputs.oligo})${e.error ? ` ✗ ${e.error}` : ""}`;
    case "state_committed":
      return `commit ${e.state.id} ${e.state.label}`;
    case "transition_committed":
      return `${e.transition.from} → ${e.transition.to} ${e.transition.op}`;
    case "state_revised":
      return e.after ? `revise ${e.state_id} (${e.caused_by})` : `remove ${e.state_id} (${e.caused_by})`;
    case "transition_revised":
      return e.after === null ? `remove transition ${e.transition_id}` : e.before === null ? `add transition ${e.transition_id}` : `revise transition ${e.transition_id}`;
    case "review_recorded":
      return `review ${e.decision} ${e.target_id} by ${e.reviewer.id}${e.note ? ` — ${e.note}` : ""}`;
    case "assumption":
      return `assume: ${e.text}`;
    case "guardrail_blocked":
      return `blocked ${e.tool}: ${e.reason}`;
    case "checkpoint":
      return `checkpoint · ${e.tokens.cumulative} tokens`;
    case "verifier_check":
      return `${e.check} ${e.status}${e.state_id ? ` ${e.state_id}` : ""}`;
    case "gt_scored":
      return `gt structure_f1 ${e.structure_f1} edge_f1 ${e.edge_f1}`;
    case "benchmark_scored":
      return `benchmark ${e.benchmark_version}: ${Object.entries(e.metrics).map(([k, v]) => `${k} ${v}`).join(", ")}`;
    case "review_finding":
      return `finding ${e.signal_id}: ${e.root_cause} → ${e.recommended_action}`;
    case "human_message":
      return `human: ${e.text}`;
    case "patch_proposed":
      return `patch ${e.patch_id} ${e.op} ${e.target}`;
    case "patch_applied":
      return `applied ${e.patch_id} → rev ${e.workflow_revision}`;
    case "harness_candidate":
      return `candidate ${e.version} ← ${e.parent} (${e.patches.length} patches)`;
    case "gate_result":
      return `gate ${e.version}: ${e.decision}`;
    case "harness_promoted":
      return `promoted ${e.version}`;
    case "paused":
    case "resumed":
      return e.t;
    case "run_finished":
      return `run_finished ${e.status}`;
    case "error":
      return `error: ${e.message}`;
  }
}

export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** 1,840 → "1,840"; 15,460 → "15.5k"; 1,109,569 → "1.1M" — for the status bar's cumulative token count. */
export const fmtCompact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 10_000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
      : fmtInt(n);

/** ISO timestamp → HH:MM:SS (UTC), or the raw string if unparsable. */
export const fmtTime = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toISOString().slice(11, 19);
};

export const fmtDelta = (d: number) => `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(2)}`;

export const fmtVal = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Backend chunk ids look like "<protocol_id>:<doc>:p008"; drop the protocol prefix for chips. */
export const shortChunk = (id: string, protocolId?: string | null) =>
  protocolId && id.startsWith(`${protocolId}:`) ? id.slice(protocolId.length + 1) : id;

/** 1 → "①" … 20 → "⑳", then "(21)". */
export const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`);
