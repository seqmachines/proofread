"use client";
// components/StartPage.tsx — / (SPEC.md §6 Start): the protocol list; per protocol one
// button per system with a result, each opening that run. "Run live" only when GET /config
// says live_runs. Backend first; the fixtures stand in when it is unreachable.
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AppConfig, HarnessVersion, Protocol } from "@/lib/events";
import { API_URL, getConfig, getHarness, getProtocols } from "@/lib/api";
import { FIXTURES, fixtureProtocols } from "@/lib/fixture";
import { cx } from "@/lib/cx";
import { isAuthor, useReviewer } from "@/lib/reviewer";
import { ProtocolList } from "./ProtocolList";
import { InvitesPanel } from "./InvitesPanel";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The offline fixtures are a developer aid: shown on localhost or with NEXT_PUBLIC_SHOW_FIXTURES=1.
const noop = () => () => {};
const isLocalHost = () => process.env.NEXT_PUBLIC_SHOW_FIXTURES === "1" || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

export function StartPage() {
  const showFixtures = useSyncExternalStore(noop, isLocalHost, () => false);
  const reviewer = useReviewer();
  const author = isAuthor(reviewer);
  const params = useSearchParams();
  // An author sees their protocol; ?protocol= narrows the list for anyone.
  const only = params.get("protocol") ?? (author ? (reviewer?.protocol_id ?? null) : null);
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
  const shown = protocols && only ? protocols.filter((p) => p.id === only) : protocols;

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-8">
      <div className="flex w-full max-w-[1000px] flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] text-muted">
          <span className="text-[13px] font-semibold text-foreground">proofread</span>
          <span className="text-[12px] text-foreground">Review agent-reconstructed sequencing-library workflows.</span>
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
            {!author && (
              <Link href="/harness" className="underline decoration-line hover:decoration-accent">
                harness
              </Link>
            )}
            {reviewer && (
              <span className="text-foreground" data-reviewer={reviewer.name}>
                {reviewer.name}
                {author ? " (author)" : ""}
              </span>
            )}
          </span>
        </div>
        {only && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted" data-scope>
            <span>
              showing <span className="text-foreground">{only}</span>
              {author ? " — your invite covers this protocol" : ""}
            </span>
            {!author && (
              <Link href="/" className="underline decoration-line hover:text-foreground">
                all protocols
              </Link>
            )}
          </div>
        )}

        <p className="text-[12px] text-muted">
          Pick a protocol and open one of its reconstructions. On the run page, click a molecule to check its strands, provenance and failed checks,
          then accept, modify, reject or leave it unresolved. Decisions need a review token from the curator; reading never does.
        </p>

        <ProtocolList protocols={shown} liveRuns={liveRuns} activeHarness={harness?._id ?? null} error={note} />

        {!author && protocols && protocols.length > 0 && <InvitesPanel protocols={protocols} tokenPresent={Boolean(reviewer?.token)} />}

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 font-mono text-[10px] text-muted" data-config>
          <span>backend {API_URL}</span>
          <span>executor {config?.executor ?? (offline ? "offline" : "?")}</span>
          <span className={cx(liveRuns && "text-emerald-600 dark:text-emerald-400")}>live runs {config ? (config.live_runs ? "yes" : "no") : "?"}</span>
          {harness && <span>active harness {harness._id}</span>}
          {showFixtures && (
            <span className="flex gap-2">
              <span>offline fixtures:</span>
              {FIXTURES.map((f) => (
                <Link key={f.routeId} href={`/runs/${f.routeId}`} className="underline decoration-line hover:text-foreground">
                  {f.routeId}
                </Link>
              ))}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
