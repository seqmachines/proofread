"use client";
// components/InvitesPanel.tsx — curator only: create author invites (one-time token → link)
// and list existing ones. Shown when the stored token can list invites.
import { useCallback, useEffect, useState } from "react";
import type { Invite, Protocol } from "@/lib/events";
import { ApiError, createInvite, listInvites } from "@/lib/api";
import { withBasePath } from "@/lib/basePath";
import { fmtTime } from "@/lib/format";
import { cx } from "@/lib/cx";

const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40";
const field =
  "h-6 rounded border border-line bg-panel px-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted/70 focus:border-accent";

export function InvitesPanel({ protocols, tokenPresent }: { protocols: Protocol[]; tokenPresent: boolean }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [pid, setPid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ invite: Invite; link: string } | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    listInvites()
      .then((list) => {
        if (cancelled) return;
        setInvites(list);
        setAllowed(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAllowed(!(e instanceof ApiError && (e.status === 401 || e.status === 403)));
        if (!(e instanceof ApiError && (e.status === 401 || e.status === 403))) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (tokenPresent) return load();
  }, [tokenPresent, load]);

  if (!tokenPresent || allowed === false) return null; // not a curator (or no identity yet)

  const create = async () => {
    if (!pid || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite(pid, name.trim());
      const link = `${window.location.origin}${withBasePath(`/invite/${encodeURIComponent(invite.token ?? "")}`)}?protocol=${encodeURIComponent(invite.protocol_id)}&name=${encodeURIComponent(invite.name)}`;
      setCreated({ invite, link });
      setName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-line bg-panel" data-invites-panel>
      <header className="flex h-8 items-center gap-2 border-b border-line px-3">
        <span className="text-[12px] font-medium">Author invites</span>
        <span className="font-mono text-[10px] text-muted">curator only · one protocol per token · the token is shown once</span>
      </header>
      <div className="flex flex-col gap-2 p-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-2">
          <select value={pid} onChange={(e) => setPid(e.target.value)} className={field} aria-label="Invite protocol">
            <option value="">— protocol —</option>
            {protocols.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="author name" className={cx(field, "w-48")} aria-label="Invite name" />
          <button className={cx(btn, "border-accent text-accent")} onClick={() => void create()} disabled={busy || !pid || !name.trim()} data-invite-create>
            {busy ? "creating…" : "create invite"}
          </button>
          {error && <span className="font-mono text-[10px] text-rose-600 dark:text-rose-400">{error}</span>}
        </div>
        {created && (
          <div className="rounded border border-accent/50 bg-accent/5 px-2 py-1.5 font-mono text-[11px]" data-invite-link>
            <div className="mb-0.5 text-muted">
              invite for {created.invite.name} · {created.invite.protocol_id} — copy this link now; the token is not stored in plain text
            </div>
            <input readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} className={cx(field, "w-full")} aria-label="Invite link" />
          </div>
        )}
        {invites && invites.length > 0 && (
          <table className="w-full border-collapse text-[11px]" data-invites>
            <thead>
              <tr className="border-b border-line font-mono text-[10px] tracking-wide text-muted uppercase">
                <th className="py-1 pr-3 text-left font-normal">name</th>
                <th className="py-1 pr-3 text-left font-normal">protocol</th>
                <th className="py-1 pr-3 text-left font-normal">role</th>
                <th className="py-1 text-right font-normal">created</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.invite_id} className="border-b border-line/60">
                  <td className="py-1 pr-3">{i.name}</td>
                  <td className="py-1 pr-3 font-mono text-muted">{i.protocol_id}</td>
                  <td className="py-1 pr-3 font-mono text-muted">{i.role}</td>
                  <td className="py-1 text-right font-mono text-muted tabular-nums">{fmtTime(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {invites && invites.length === 0 && <div className="font-mono text-[11px] text-muted">no invites yet</div>}
      </div>
    </section>
  );
}
