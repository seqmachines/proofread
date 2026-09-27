"use client";
// lib/fixture.ts — offline demo fallbacks. Run ids:
//   /runs/fixture        → fixtures/run_example.jsonl       (backend's exported real run)
//   /runs/fixture-<name> → fixtures/run_example_<name>.jsonl
//     fixture-loop: synthetic full loop · fixture-benchmark: synthetic imported benchmark record
// These keep working after go-live.
import { useEffect, useState } from "react";
import type { Protocol, RunEvent } from "./events";
import { withBasePath } from "./basePath";
import { fold, parseJsonl } from "./reducer";

export const FIXTURE_RUN_ID = "fixture";
export const FIXTURE_LOOP_RUN_ID = "fixture-loop";
export const FIXTURE_BENCHMARK_RUN_ID = "fixture-benchmark"; // synthetic imported benchmark record (§4)

/** Every fixture the offline pages fold: route id → file name suffix. */
export const FIXTURES: { routeId: string; name: string }[] = [
  { routeId: FIXTURE_RUN_ID, name: "" },
  { routeId: FIXTURE_LOOP_RUN_ID, name: "loop" },
  { routeId: FIXTURE_BENCHMARK_RUN_ID, name: "benchmark" },
];

/** "" for the default fixture, "<name>" for a named one, null for a live run id. */
export function fixtureName(runId: string): string | null {
  if (runId === FIXTURE_RUN_ID) return "";
  if (runId.startsWith(`${FIXTURE_RUN_ID}-`)) return runId.slice(FIXTURE_RUN_ID.length + 1);
  return null;
}

export const isFixtureRun = (runId: string) => fixtureName(runId) !== null;

export async function loadFixtureEvents(name = ""): Promise<RunEvent[]> {
  const res = await fetch(withBasePath(`/api/fixture${name ? `?name=${encodeURIComponent(name)}` : ""}`), { cache: "no-store" });
  if (!res.ok) throw new Error(`fixture: HTTP ${res.status} — ${await res.text()}`);
  return parseJsonl(await res.text());
}

/** Events of a fixture, or an empty list when `name` is null (live run). */
export function useFixtureEvents(name: string | null): { events: RunEvent[]; error: string | null } {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (name === null) return;
    let cancelled = false;
    loadFixtureEvents(name)
      .then((ev) => {
        if (!cancelled) setEvents(ev);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [name]);
  return { events, error };
}

/** The fixtures folded into the GET /protocols shape: one protocol per protocol_id, one
 *  source (button) per fixture run. Used when the backend is unreachable. */
export async function fixtureProtocols(): Promise<Protocol[]> {
  const byId = new Map<string, Protocol>();
  for (const { routeId, name } of FIXTURES) {
    let ui;
    try {
      ui = fold(await loadFixtureEvents(name));
    } catch {
      continue;
    }
    const id = ui.protocolId ?? routeId;
    const p = byId.get(id) ?? { id, name: id, family: "—", role: "dev" as const, has_gt: ui.gtScore !== null || ui.benchmarkScore !== null, sources: [] };
    p.has_gt = p.has_gt || ui.gtScore !== null;
    p.sources!.push({
      run_id: routeId,
      source: ui.source ?? "fixture",
      executor: ui.executor ?? "—",
      model: "—",
      harness_version: ui.harnessVersion ?? "?",
      benchmark_score: ui.benchmarkScore,
    });
    byId.set(id, p);
  }
  return Array.from(byId.values());
}
