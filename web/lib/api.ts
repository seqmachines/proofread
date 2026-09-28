// lib/api.ts — fetch + SSE client for the backend (SPEC.md §2.5).
// Base URL from NEXT_PUBLIC_API_URL (default http://localhost:8000).
// Streaming: EventSource with reconnect from the last seq; polling when
// NEXT_PUBLIC_STREAM_MODE=poll.
import type {
  AppConfig,
  BenchmarkRow,
  Chunk,
  Entity,
  Invite,
  GtDiff,
  HarnessVersion,
  MoleculeState,
  Protocol,
  QueueItem,
  Review,
  ReviewInput,
  ReviewResponse,
  Run,
  RunEvent,
  Workflow,
} from "./events";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const STREAM_MODE: "sse" | "poll" = process.env.NEXT_PUBLIC_STREAM_MODE === "poll" ? "poll" : "sse";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  } catch (e) {
    throw new ApiError(0, `backend unreachable at ${API_URL} (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${res.status} ${path}: ${detail}`);
  }
  return (await res.json()) as T;
}

import { getReviewer } from "./reviewer";

/** POST helper. Write routes need X-Review-Token (§2.6); it is added whenever an identity is stored. */
const json = (body: unknown): RequestInit => {
  const token = getReviewer()?.token;
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "X-Review-Token": token } : {}) },
    body: JSON.stringify(body),
  };
};

export const isAuthError = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

export const getProtocols = () => api<Protocol[]>("/protocols");
export const getConfig = () => api<AppConfig>("/config");

export type Executor = "codex" | "claude_code" | "gemini_cli" | "api_loop";

/** POST /runs {protocol_id, harness_version?, executor?}. Until M9 lands the backend rejects
 *  unknown fields with 422, so a first 422 retries once without `executor`. */
export async function startRun(
  protocol_id: string,
  opts: { harness_version?: string; executor?: Executor } = {},
): Promise<{ run_id: string }> {
  const body: Record<string, unknown> = { protocol_id };
  if (opts.harness_version) body.harness_version = opts.harness_version;
  if (opts.executor) body.executor = opts.executor;
  try {
    return await api<{ run_id: string }>("/runs", json(body));
  } catch (e) {
    if (e instanceof ApiError && e.status === 422 && "executor" in body) {
      delete body.executor;
      return api<{ run_id: string }>("/runs", json(body));
    }
    throw e;
  }
}

export const getRun = (id: string) => api<{ run: Run; workflow: Workflow | null }>(`/runs/${encodeURIComponent(id)}`);
export const getEvents = (id: string, since = 0) =>
  api<RunEvent[]>(`/runs/${encodeURIComponent(id)}/events?since=${since}`);
export const getGtDiff = (id: string) => api<GtDiff>(`/runs/${encodeURIComponent(id)}/gt-diff`);
export const getChunk = (id: string) => api<Chunk>(`/chunks/${encodeURIComponent(id)}`);

export interface PatchProposal {
  patch_id: string;
  op: string;
  target: string;
  before: MoleculeState | null;
  after: MoleculeState | null;
  reason: string;
}
/** After-run: the editor answers with a patch (also emitted as patch_proposed). During-run: {queued: true}. */
export const sendMessage = (id: string, text: string) =>
  api<{ patch?: PatchProposal; queued?: boolean }>(`/runs/${encodeURIComponent(id)}/messages`, json({ text }));
export const applyPatch = (id: string, patchId: string, systematic?: boolean) =>
  api<{ workflow_revision: number; stale: string[] }>(
    `/runs/${encodeURIComponent(id)}/patches/${encodeURIComponent(patchId)}/apply`,
    json(systematic === undefined ? {} : { systematic }),
  );

/** POST /runs/{id}/reviews — the typed capture of a human decision (§2.5); fans out per §5. */
export const postReview = (id: string, review: ReviewInput) =>
  api<ReviewResponse>(`/runs/${encodeURIComponent(id)}/reviews`, json(review));
export const getReviews = (id: string) => api<Review[]>(`/runs/${encodeURIComponent(id)}/reviews`);
export const getQueue = () => api<QueueItem[]>("/queue");
/** GET /memory?operation=&type= — verified entities only. */
export function getMemory(filter: { operation?: string; type?: string } = {}): Promise<Entity[]> {
  const q = new URLSearchParams();
  if (filter.operation) q.set("operation", filter.operation);
  if (filter.type) q.set("type", filter.type);
  const qs = q.toString();
  return api<Entity[]>(`/memory${qs ? `?${qs}` : ""}`);
}
export type BenchmarkGroupBy = "version" | "executor" | "protocol";
/** GET /benchmark?group_by= → rows. The live shape is aggregated:
 *  {group, group_by, runs, gt_scored_runs, gt_score, benchmark_score}; it is mapped onto
 *  BenchmarkRow (the grouped dimension filled from `group`). A bare BenchmarkRow[] passes through. */
export async function getBenchmark(groupBy: BenchmarkGroupBy): Promise<BenchmarkRow[]> {
  const res = await api<unknown>(`/benchmark?group_by=${groupBy}`);
  let rows: unknown[] = [];
  if (Array.isArray(res)) rows = res;
  else if (res && typeof res === "object") {
    for (const k of ["rows", "groups", "items", "results"]) {
      const v = (res as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        rows = v;
        break;
      }
    }
  }
  return rows.map((r) => {
    const x = r as Record<string, unknown>;
    if (typeof x.group !== "string") return x as BenchmarkRow;
    const dim = (x.group_by as string) ?? groupBy;
    const gt = (x.gt_score ?? null) as { structure_f1?: number; edge_f1?: number } | null;
    return {
      protocol: dim === "protocol" ? x.group : undefined,
      executor: dim === "executor" ? x.group : undefined,
      harness_version: dim === "version" ? x.group : undefined,
      runs: typeof x.runs === "number" ? x.runs : undefined,
      gt_scored_runs: typeof x.gt_scored_runs === "number" ? x.gt_scored_runs : undefined,
      structure_f1: gt?.structure_f1 ?? null,
      edge_f1: gt?.edge_f1 ?? null,
      benchmark: (x.benchmark_score ?? null) as BenchmarkRow["benchmark"],
      source: "backend",
    } satisfies BenchmarkRow;
  });
}
/** Curator only. GET needs the token too (sent when stored). */
export const listInvites = () => {
  const t = getReviewer()?.token;
  const headers: Record<string, string> = t ? { "X-Review-Token": t } : {};
  return api<Invite[]>("/invites", { headers });
};
export const createInvite = (protocol_id: string, name: string) => api<Invite>("/invites", json({ protocol_id, name }));
export const getHarness = () => api<HarnessVersion>("/harness");
export const getHarnessVersions = () => api<HarnessVersion[]>("/harness/versions");
export const getHarnessVersion = (v: string) => api<HarnessVersion>(`/harness/versions/${encodeURIComponent(v)}`);

export type ConnectionStatus = "idle" | "connecting" | "live" | "reconnecting" | "polling" | "closed" | "error";

export interface SubscribeOptions {
  since?: number;
  speed?: number; // >1 → the server replays stored events with 1/speed-second gaps
  onEvent: (e: RunEvent) => void;
  onStatus?: (status: ConnectionStatus, detail?: string) => void;
}

/** Follow a run's events. Returns an unsubscribe function. Events are delivered in seq order, each at most once. */
export function subscribe(runId: string, opts: SubscribeOptions): () => void {
  let lastSeq = opts.since ?? 0;
  let closed = false;
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  const status = (s: ConnectionStatus, d?: string) => opts.onStatus?.(s, d);
  const handle = (e: RunEvent) => {
    if (typeof e.seq !== "number" || e.seq <= lastSeq) return;
    lastSeq = e.seq;
    opts.onEvent(e);
  };
  const stop = () => {
    closed = true;
    es?.close();
    es = null;
    if (timer) clearTimeout(timer);
    status("closed");
  };

  if (STREAM_MODE === "poll") {
    const tick = async () => {
      if (closed) return;
      try {
        (await getEvents(runId, lastSeq)).forEach(handle);
        status("polling");
      } catch (e) {
        status("error", e instanceof Error ? e.message : String(e));
      }
      if (!closed) timer = setTimeout(tick, 1000);
    };
    void tick();
    return stop;
  }

  const open = () => {
    if (closed) return;
    status(attempt === 0 ? "connecting" : "reconnecting");
    const speed = opts.speed && opts.speed > 1 ? `&speed=${opts.speed}` : "";
    es = new EventSource(`${API_URL}/runs/${encodeURIComponent(runId)}/stream?since=${lastSeq}${speed}`);
    es.onopen = () => {
      attempt = 0;
      status("live");
    };
    es.onmessage = (m: MessageEvent<string>) => {
      try {
        handle(JSON.parse(m.data) as RunEvent);
      } catch {
        /* ignore a malformed frame */
      }
    };
    es.onerror = () => {
      es?.close();
      es = null;
      if (closed) return;
      attempt += 1;
      const delay = Math.min(10_000, 1000 * 2 ** Math.min(attempt - 1, 3));
      status("reconnecting", `retry in ${delay / 1000}s from seq ${lastSeq}`);
      timer = setTimeout(open, delay);
    };
  };
  open();
  return stop;
}
