"use client";
// components/Toaster.tsx — stacked toasts, top-right under the header; click × to dismiss.
import { dismissToast, useToasts } from "@/lib/toast";
import { cx } from "@/lib/cx";

export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed top-11 right-3 z-50 flex w-[340px] flex-col gap-1.5" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          data-toast={t.kind}
          className={cx(
            "pointer-events-auto flex items-start gap-2 rounded border bg-panel px-2 py-1.5 font-mono text-[11px] leading-4 shadow-[0_2px_8px_rgba(0,0,0,0.12)]",
            t.kind === "error" ? "border-rose-500/60 text-rose-600 dark:text-rose-400" : "border-line text-foreground",
          )}
        >
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          <button onClick={() => dismissToast(t.id)} className="text-muted hover:text-foreground" aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
