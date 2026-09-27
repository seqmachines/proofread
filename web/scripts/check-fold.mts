// F0 done-when: fold(fixture) yields ≥5 nodes, ≥4 edges, ≥4 trace steps.
//   npm run check:fold
import { readFileSync } from "node:fs";
import { fold, parseJsonl } from "../lib/reducer.ts";

const fixture = new URL("../../fixtures/run_example.jsonl", import.meta.url);
const events = parseJsonl(readFileSync(fixture, "utf8"));
const ui = fold(events);

const committed = ui.nodes.filter((n) => !n.data.ghost);
const summary = {
  events: events.length,
  nodes: committed.length,
  ghosts: ui.nodes.length - committed.length,
  edges: ui.edges.length,
  traceSteps: ui.trace.length,
  checks: `${ui.checks.length} (${ui.checks.filter((c) => c.status === "fail").length} fail)`,
  findings: ui.findings.length,
  status: ui.status,
  step: ui.step,
  harness: `${ui.harnessVersion} → candidate ${ui.harness.candidate?.version ?? "-"} / gate ${ui.harness.gateResult?.decision ?? "-"} / promoted ${ui.harness.promoted ?? "-"}`,
  revision: ui.workflowRevision,
  tokens: `${ui.tokens.lastCall} last / ${ui.tokens.cumulative} cumulative`,
};
console.log(summary);
console.log(
  "positions:",
  committed.map((n) => `${n.id}@(${n.position.x},${n.position.y})${n.data.failed ? " ✗" + n.data.failed : ""}`).join("  "),
);
console.log("edges:", ui.edges.map((e) => `${e.source}→${e.target} ${e.label}${e.data?.llm ? " (llm)" : ""}`).join("  "));
console.log("trace:", ui.trace.map((t) => `#${t.step}[${t.events.length}]`).join(" "));

const ok = committed.length >= 5 && ui.edges.length >= 4 && ui.trace.length >= 4;
console.log(ok ? "F0 done-when: PASS" : "F0 done-when: FAIL");
process.exit(ok ? 0 : 1);
