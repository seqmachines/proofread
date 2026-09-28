"use client";
// components/ReviewerPrompt.tsx — asked once, on the first write: reviewer name + token.
import { useState } from "react";
import type { ReviewerIdentity } from "@/lib/reviewer";
import { cx } from "@/lib/cx";

const field =
  "h-7 w-full rounded border border-line bg-panel px-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted/70 focus:border-accent";
const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40";

export function ReviewerPrompt({
  initial,
  reason,
  onSave,
  onCancel,
}: {
  initial: ReviewerIdentity | null;
  reason?: string | null;
  onSave: (r: ReviewerIdentity) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [token, setToken] = useState(initial?.token ?? "");
  const ok = name.trim().length > 0 && token.trim().length > 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label="Reviewer identity" data-reviewer-prompt>
      <form
        className="w-[380px] rounded border border-line bg-panel p-3 text-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.25)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave({ name: name.trim(), token: token.trim() });
        }}
      >
        <div className="mb-1 font-medium">Who is reviewing?</div>
        <p className="mb-2 text-[11px] text-muted">
          Reviews are attributed to a named reviewer. You need a review token from the curator who runs this instance; it is checked by the backend and
          stays in this browser only. Reading and replaying runs never needs one.
        </p>
        {reason && <div className="mb-2 font-mono text-[11px] text-rose-600 dark:text-rose-400">{reason}</div>}
        <label className="mb-1 block font-mono text-[10px] text-muted uppercase">name</label>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" autoFocus aria-label="Reviewer name" />
        <label className="mt-2 mb-1 block font-mono text-[10px] text-muted uppercase">review token</label>
        <input className={field} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="token" aria-label="Review token" autoComplete="off" />
        <div className="mt-3 flex items-center gap-2">
          <button type="submit" className={cx(btn, "border-accent text-accent")} disabled={!ok}>
            save and continue
          </button>
          <button type="button" className={btn} onClick={onCancel}>
            cancel
          </button>
        </div>
      </form>
    </div>
  );
}
