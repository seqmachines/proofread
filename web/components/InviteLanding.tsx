"use client";
// components/InviteLanding.tsx — /invite/<token>?protocol=<id>&name=<name> (SPEC.md §6, M15):
// stores the author identity (name, token, role author, protocol scope) in this browser and
// opens that protocol's runs. The token is never shown again after this page.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Protocol } from "@/lib/events";
import { getProtocols } from "@/lib/api";
import { setReviewer } from "@/lib/reviewer";
import { cx } from "@/lib/cx";

const btn =
  "h-7 rounded border border-line bg-panel px-3 font-mono text-[12px] leading-6 text-foreground hover:border-accent disabled:opacity-40";
const field =
  "h-7 w-full rounded border border-line bg-panel px-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted/70 focus:border-accent";

export function InviteLanding({ token, protocolId, name }: { token: string; protocolId: string | null; name: string | null }) {
  const router = useRouter();
  const [protocols, setProtocols] = useState<Protocol[] | null>(null);
  const [who, setWho] = useState(name ?? "");
  const [pid, setPid] = useState(protocolId ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProtocols()
      .then((ps) => {
        if (!cancelled) setProtocols(ps);
      })
      .catch(() => {
        if (!cancelled) setProtocols([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const protocol = protocols?.find((p) => p.id === pid) ?? null;
  const ready = who.trim().length > 0 && pid.length > 0;

  const accept = () => {
    setReviewer({ name: who.trim(), token, role: "author", protocol_id: pid });
    setSaved(true);
    router.push(`/?protocol=${encodeURIComponent(pid)}`);
  };

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="w-full max-w-[520px] rounded border border-line bg-panel p-4 text-[12px]" data-invite-landing>
        <div className="mb-1 font-mono text-[13px] font-semibold">proofread · reviewer invite</div>
        <p className="mb-3 text-muted">
          This link carries a review token for one protocol. Accepting stores it in this browser, so your decisions are attributed to you and
          scoped to that protocol. Nothing is sent anywhere until you save a review.
        </p>
        <label className="mb-1 block font-mono text-[10px] text-muted uppercase">your name</label>
        <input className={field} value={who} onChange={(e) => setWho(e.target.value)} placeholder="name shown on your reviews" aria-label="Your name" />
        <label className="mt-2 mb-1 block font-mono text-[10px] text-muted uppercase">protocol</label>
        {protocolId ? (
          <div className="font-mono text-[12px]" data-invite-protocol={pid}>
            {protocol?.name ?? pid} <span className="text-muted">({pid})</span>
          </div>
        ) : (
          <select className={field} value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Protocol">
            <option value="">— choose the protocol this invite is for —</option>
            {(protocols ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button className={cx(btn, "border-accent text-accent")} onClick={accept} disabled={!ready || saved} data-invite-accept>
            {saved ? "opening…" : "accept and open the runs"}
          </button>
          <Link href="/" className="font-mono text-[11px] text-muted underline decoration-line hover:text-foreground">
            not now
          </Link>
        </div>
        <p className="mt-3 font-mono text-[10px] text-muted">
          As an author you can accept, modify, reject or leave states unresolved on this protocol; harness changes, invites and memory verification
          stay with the curator.
        </p>
      </div>
    </main>
  );
}
