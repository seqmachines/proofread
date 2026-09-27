"use client";
// components/StartPage.tsx — / (SPEC.md §6 Start): the protocol list; per protocol one
// button per system with a result, each opening that run. "Run live" only when GET /config
// says live_runs. Backend first; the fixtures stand in when it is unreachable.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AppConfig, HarnessVersion, Protocol } from "@/lib/events";
import { API_URL, getConfig, getHarness, getProtocols } from "@/lib/api";
import { FIXTURES, fixtureProtocols } from "@/lib/fixture";
import { cx } from "@/lib/cx";
import { ProtocolList } from "./ProtocolList";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function StartPage() {
  const [protocols, setProtocols] = useState<Protocol[] | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [harness, setHarness] = useState<HarnessVersion | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProtocols()
      .then((p) => {
        if (!cancelled) setProtocols(p);
      })
      .catch(async (e: unknown) => {
        // Backend unreachable: the fixtures, folded into the same shape.
        const fx = await fixtureProtocols();
        if (cancelled) return;
        setOffline(true);
        setProtocols(fx);
        setNote(`backend unreachable (${msg(e)}) — showing the fixtures`);
      });
    getConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        /* live_runs unknown → "run live" hidden */
      });
    getHarness()
      .then((h) => {
        if (!cancelled) setHarness(h);
      })
      .catch(() => {
        /* label falls back to "active" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const liveRuns = config?.live_runs === true;

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-8">
      <div className="flex w-full max-w-[1000px] flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] text-muted">
          <span className="text-[13px] font-semibold text-foreground">proofread</span>
          <span>backend {API_URL}</span>
          <span>·</span>
          <span data-config>
            executor <span className="text-foreground">{config?.executor ?? (offline ? "offline" : "?")}</span> · live runs{" "}
            <span className={cx(liveRuns ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{config ? (config.live_runs ? "yes" : "no") : "?"}</span>
            {config?.stream_mode && <> · stream {config.stream_mode}</>}
            {harness && (
              <>
                {" "}
                · active harness <span className="text-foreground">{harness._id}</span>
              </>
            )}
          </span>
          <span className="ml-auto flex shrink-0 gap-3 whitespace-nowrap">
            <Link href="/queue" className="underline decoration-line hover:decoration-accent">
              queue
            </Link>
            <Link href="/memory" className="underline decoration-line hover:decoration-accent">
              memory
            </Link>
            <Link href="/benchmark" className="underline decoration-line hover:decoration-accent">
              benchmark
            </Link>
            <Link href="/harness" className="underline decoration-line hover:decoration-accent">
              harness
            </Link>
          </span>
        </div>

        <ProtocolList protocols={protocols} liveRuns={liveRuns} activeHarness={harness?._id ?? null} error={note} />

        <div className="flex flex-wrap gap-3 font-mono text-[10px] text-muted">
          <span>offline fixtures:</span>
          {FIXTURES.map((f) => (
            <Link key={f.routeId} href={`/runs/${f.routeId}`} className="underline decoration-line hover:text-foreground">
              {f.routeId}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
