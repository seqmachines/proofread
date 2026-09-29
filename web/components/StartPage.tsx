"use client";
// components/StartPage.tsx — / (SPEC.md §6 Start): the protocol list; per protocol one
// button per system with a result, each opening that run. "Run live" only when GET /config
// says live_runs. Backend first; the fixtures stand in when it is unreachable.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AppConfig, HarnessVersion, Protocol } from "@/lib/events";
import { getConfig, getHarness, getProtocols } from "@/lib/api";
import { fixtureProtocols } from "@/lib/fixture";
import { isAuthor, useReviewer } from "@/lib/reviewer";
import { ProtocolList } from "./ProtocolList";
import { InvitesPanel } from "./InvitesPanel";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function StartPage() {
  const reviewer = useReviewer();
  const author = isAuthor(reviewer);
  const params = useSearchParams();
  // An author sees their protocol; ?protocol= narrows the list for anyone.
  const only = params.get("protocol") ?? (author ? (reviewer?.protocol_id ?? null) : null);
  const [protocols, setProtocols] = useState<Protocol[] | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [harness, setHarness] = useState<HarnessVersion | null>(null);
  const [note, setNote] = useState<string | null>(null);

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
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">proofread</h1>
          <span className="text-[13px] text-muted">Review agent-reconstructed sequencing-library workflows.</span>
          <span className="ml-auto flex shrink-0 items-baseline gap-3 whitespace-nowrap">
            <Link href="/benchmark" className="text-[14px] text-foreground underline decoration-line underline-offset-4 hover:decoration-accent">
              benchmark
            </Link>
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

        <ProtocolList protocols={shown} liveRuns={liveRuns} activeHarness={harness?._id ?? null} error={note} />

        {!author && protocols && protocols.length > 0 && <InvitesPanel protocols={protocols} tokenPresent={Boolean(reviewer?.token)} />}

      </div>
    </main>
  );
}
