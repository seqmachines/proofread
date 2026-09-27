// lib/harness.ts — harness versions synthesized from a run's events (offline source for
// /harness when the backend has no loop yet): run_started names the base version,
// harness_candidate applies patches to its parent, gate_result fills eval, and
// harness_promoted flips statuses per §2.3 (promoted → active, previous active → superseded).
import type { HarnessPatch, HarnessVersion, RunEvent } from "./events";

// §2.3's v0 example; the synthetic fixture was written against it.
function baseVersion(id: string, created_at: string): HarnessVersion {
  return {
    _id: id,
    parent_id: null,
    status: "active",
    rules: [],
    context_policy: { evidence_k: 5, history: "state_only", include_linked_oligos: false },
    guardrails: ["evidence_required"],
    tool_access: { reverse_transcribe: "available", template_switch: "available" },
    patches: [],
    source_signals: [],
    eval: null,
    created_at,
  };
}

/** Apply one §2.3 patch by dotted path ("tool_access.template_switch", "guardrails", "rules"). */
export function applyHarnessPatch(v: HarnessVersion, p: HarnessPatch): HarnessVersion {
  const next = structuredClone(v);
  const parts = p.path.split(".");
  let obj = next as unknown as Record<string, unknown>;
  for (const k of parts.slice(0, -1)) {
    if (typeof obj[k] !== "object" || obj[k] === null) obj[k] = {};
    obj = obj[k] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  const cur = obj[last];
  // A rule/guardrail patch may give the new element rather than the whole list.
  obj[last] = Array.isArray(cur) && !Array.isArray(p.to) && typeof p.to === "string" ? [...cur, p.to] : p.to;
  return next;
}

export function versionsFromEvents(events: RunEvent[]): HarnessVersion[] {
  const byId = new Map<string, HarnessVersion>();
  const order: string[] = [];
  const ensure = (id: string, ts: string) => {
    let v = byId.get(id);
    if (!v) {
      v = baseVersion(id, ts);
      byId.set(id, v);
      order.push(id);
    }
    return v;
  };
  for (const e of events) {
    switch (e.t) {
      case "run_started":
        ensure(e.harness_version, e.ts);
        break;
      case "harness_candidate": {
        const parent = ensure(e.parent, e.ts);
        const v: HarnessVersion = {
          ...e.patches.reduce(applyHarnessPatch, parent),
          _id: e.version,
          parent_id: e.parent,
          status: "candidate",
          patches: e.patches,
          source_signals: [],
          eval: null,
          created_at: e.ts,
        };
        byId.set(e.version, v);
        if (!order.includes(e.version)) order.push(e.version);
        break;
      }
      case "gate_result": {
        const v = ensure(e.version, e.ts);
        const target = e.results.find((r) => r.role === "target") ?? e.results[0];
        v.eval = { target, regression: e.results.filter((r) => r.role === "regression"), decision: e.decision, reason: e.reason };
        if (e.decision === "reject") v.status = "rejected";
        break;
      }
      case "harness_promoted": {
        for (const v of byId.values()) if (v.status === "active") v.status = "superseded";
        ensure(e.version, e.ts).status = "active";
        break;
      }
      default:
        break;
    }
  }
  return order.map((id) => byId.get(id)!).reverse(); // newest first
}
