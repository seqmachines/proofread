"use client";
// components/Chat.tsx — the thin chat bar at the bottom (SPEC.md §5.0) plus the
// conversation above it: human messages and patch_proposed diff cards (before/after
// segment rows, reason, Apply / Cancel, "this will recur"). Input is disabled while
// the run is running (during-run chat is a stretch goal).
import { useEffect, useRef, useState } from "react";
import { ERROR_TYPES, type ErrorType, type MoleculeState, type Segment } from "@/lib/events";
import type { ChatItem, Patch, UIState } from "@/lib/reducer";
import { fmtTime } from "@/lib/format";
import { cx } from "@/lib/cx";
import { SegmentBlocks } from "./SegmentBlocks";

const btn =
  "h-6 rounded border border-line bg-panel px-2 font-mono text-[11px] leading-5 text-foreground hover:border-accent disabled:opacity-40 disabled:hover:border-line";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const key = (s: Segment) => `${s.name}|${s.type}`;

function StateRows({ state, other, tone }: { state: MoleculeState; other: MoleculeState | null; tone: "added" | "removed" }) {
  const rows: ["top" | "bottom", string, string][] = [
    ["top", "5′", "3′"],
    ["bottom", "3′", "5′"],
  ];
  return (
    <div className="flex flex-col gap-1">
      {rows.map(([strand, a, b]) => {
        const mine = state.strands[strand];
        const theirs = new Set((other?.strands[strand] ?? []).map(key));
        const marks = new Set(mine.map((s, i) => (theirs.has(key(s)) ? -1 : i)).filter((i) => i >= 0));
        return (
          <div key={strand} className="flex items-center gap-2 font-mono text-[10px] text-muted">
            <span>{a}</span>
            <SegmentBlocks segments={mine} marks={other ? marks : undefined} tone={tone} />
            <span>{b}</span>
          </div>
        );
      })}
    </div>
  );
}

function PatchCard({
  patch,
  recur,
  onRecur,
  errorType,
  onErrorType,
  onApply,
  onCancel,
  busy,
  dismissed,
}: {
  patch: Patch;
  recur: boolean;
  onRecur: (v: boolean) => void;
  errorType: ErrorType | "";
  onErrorType: (t: ErrorType | "") => void;
  onApply: () => void;
  onCancel: () => void;
  busy: boolean;
  dismissed: boolean;
}) {
  const applied = patch.status === "applied";
  return (
    <li
      data-patch={patch.patch_id}
      className={cx(
        "rounded border px-2 py-1.5 text-[11px] leading-4",
        applied ? "border-emerald-500/50" : dismissed ? "border-line opacity-60" : "border-accent/60",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[10px]">
        <span className="text-accent">{patch.patch_id}</span>
        <span>{patch.op}</span>
        <span className="text-muted">on</span>
        <span>{patch.target}</span>
        <span className="ml-auto text-muted">
          {applied ? `applied · rev ${patch.applied_revision}` : dismissed ? "dismissed" : "proposed"}
        </span>
      </div>
      <p className="mt-0.5 text-muted">{patch.reason}</p>
      {!dismissed && (
        <div className="mt-1.5 grid grid-cols-[3.5rem_1fr] items-start gap-x-2 gap-y-1.5">
          <span className="font-mono text-[10px] text-muted uppercase">before</span>
          <div>{patch.before ? <StateRows state={patch.before} other={patch.after} tone="removed" /> : <span className="text-muted">— new state</span>}</div>
          <span className="font-mono text-[10px] text-muted uppercase">after</span>
          <div>{patch.after ? <StateRows state={patch.after} other={patch.before} tone="added" /> : <span className="text-muted">— state removed</span>}</div>
        </div>
      )}
      {applied && (
        <div className="mt-1 font-mono text-[10px] text-muted">
          {patch.stale.length > 0 ? `stale: ${patch.stale.join(", ")}` : "no downstream states affected"}
        </div>
      )}
      {!applied && !dismissed && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 font-mono text-[10px] text-muted">
            <span>error category</span>
            <select value={errorType} onChange={(e) => onErrorType(e.target.value as ErrorType | "")} className="h-6 rounded border border-line bg-panel px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-accent" aria-label="Error category" data-patch-error-type>
              <option value="">— required —</option>
              {ERROR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 font-mono text-[10px] text-muted">
            <input type="checkbox" checked={recur} onChange={(e) => onRecur(e.target.checked)} className="accent-accent" />
            this will recur (systematic)
          </label>
          <button className={cx(btn, "ml-auto border-accent text-accent")} onClick={onApply} disabled={busy || !errorType} title={errorType ? "records a modify review (POST /runs/{id}/reviews)" : "pick an error category first"}>
            {busy ? "applying…" : "apply as modify"}
          </button>
          <button className={btn} onClick={onCancel} disabled={busy}>
            cancel
          </button>
        </div>
      )}
    </li>
  );
}

function HumanRow({ item }: { item: Extract<ChatItem, { kind: "human" }> }) {
  return (
    <li className="flex gap-2 text-[11px] leading-4" data-chat="human">
      <span className="w-12 shrink-0 font-mono text-[10px] text-muted uppercase">you</span>
      <span className="min-w-0 flex-1">{item.text}</span>
      <span className="font-mono text-[10px] text-muted tabular-nums">
        {item.mode} · {fmtTime(item.ts)}
      </span>
    </li>
  );
}

export interface ChatProps {
  ui: UIState;
  offline: boolean; // /runs/fixture: the local editor stand-in answers instead of the backend
  text: string; // the draft lives in the page so "modify" can prefill it
  onText: (t: string) => void;
  focusKey?: number; // bump to focus the input
  onSend: (text: string) => Promise<string | void>; // resolves to an optional info line
  onApply: (patch: Patch, systematic: boolean, errorType: ErrorType) => Promise<void>; // applies as a modify review
  pendingErrorType?: { target: string; error_type: ErrorType } | null; // chosen in the inspector before "modify"
  showInput?: boolean; // false under EXECUTOR=none: no editor to talk to; patch cards still render here
}

export function Chat({ ui, offline, text, onText, focusKey = 0, onSend, onApply, pendingErrorType = null, showInput = true }: ChatProps) {
  const setText = onText;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusKey > 0) inputRef.current?.focus();
  }, [focusKey]);
  const [busy, setBusy] = useState<string | null>(null); // "send" | patch_id
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [recur, setRecur] = useState<Record<string, boolean>>({});
  const [types, setTypes] = useState<Record<string, ErrorType | "">>({});
  const typeFor = (p: Patch): ErrorType | "" =>
    types[p.patch_id] ?? (pendingErrorType && pendingErrorType.target === p.target ? pendingErrorType.error_type : "");
  const [collapsed, setCollapsed] = useState(false);

  const enabled = ui.status === "done" || ui.status === "failed" || ui.status === "reviewing";
  const example = ui.nodes.find((n) => !n.data.ghost)?.id ?? "S2";
  const patches = new Map(ui.patches.map((p) => [p.patch_id, p]));
  const items = ui.chat;

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy("send");
    setNote(null);
    try {
      const info = await onSend(t);
      setText("");
      setCollapsed(false);
      if (info) setNote({ kind: "info", text: info });
    } catch (e) {
      setNote({ kind: "error", text: msg(e) });
    } finally {
      setBusy(null);
    }
  };

  const apply = async (p: Patch) => {
    const t = typeFor(p);
    if (!t) return;
    setBusy(p.patch_id);
    setNote(null);
    try {
      await onApply(p, Boolean(recur[p.patch_id]), t);
    } catch (e) {
      setNote({ kind: "error", text: msg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-t border-line">
      {items.length > 0 && !collapsed && (
        <div className="h-[25vh] overflow-y-auto border-b border-line bg-panel px-3 py-2" data-chat-log>
          <ul className="flex flex-col gap-1.5">
            {items.map((it) => {
              if (it.kind === "human") return <HumanRow key={it.seq} item={it} />;
              const p = patches.get(it.patch_id);
              return p ? (
                <PatchCard
                  key={it.seq}
                  patch={p}
                  recur={Boolean(recur[p.patch_id])}
                  onRecur={(v) => setRecur((r) => ({ ...r, [p.patch_id]: v }))}
                  errorType={typeFor(p)}
                  onErrorType={(t) => setTypes((m) => ({ ...m, [p.patch_id]: t }))}
                  onApply={() => void apply(p)}
                  onCancel={() => setDismissed((d) => [...d, p.patch_id])}
                  busy={busy === p.patch_id}
                  dismissed={dismissed.includes(p.patch_id)}
                />
              ) : null;
            })}
          </ul>
        </div>
      )}
      {!showInput && items.length === 0 && (
        <div className="flex h-7 items-center gap-2 px-3 font-mono text-[10px] text-muted" data-chat-hidden>
          no chat editor on this backend · modify a state from the inspector; patch cards appear here
        </div>
      )}
      {!showInput && items.length > 0 && (
        <div className="flex h-7 items-center gap-2 px-3 font-mono text-[10px] text-muted" data-chat-hidden>
          patch cards · apply records a modify review
          <button className={cx(btn, "ml-auto")} onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? `show ${items.length}` : "hide"}
          </button>
        </div>
      )}
      <div className={cx("flex min-h-[3.25rem] items-center gap-2 px-3 py-1.5", !showInput && "hidden")}>
        <span className="font-mono text-[10px] tracking-wide text-muted uppercase">chat</span>
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={!enabled || busy === "send"}
          placeholder={
            enabled
              ? offline
                ? `offline editor — e.g. “add a 5′ handle to ${example}” or “remove the primer from ${example}”`
                : `e.g. “the RT primer has a 5′ handle, fix ${example}”`
              : `chat opens when the run finishes (${ui.status})`
          }
          className="min-w-0 flex-1 resize-none rounded border border-line bg-panel px-2 py-1 text-[12px] leading-4 text-foreground outline-none placeholder:text-muted/70 focus:border-accent disabled:text-muted"
          aria-label="Chat message"
        />
        {note && (
          <span
            className={cx("max-w-[26rem] truncate font-mono text-[10px]", note.kind === "error" ? "text-rose-600 dark:text-rose-400" : "text-muted")}
            title={note.text}
          >
            {note.text}
          </span>
        )}
        {items.length > 0 && (
          <button className={btn} onClick={() => setCollapsed((c) => !c)} title={collapsed ? "Show the conversation" : "Hide the conversation"}>
            {collapsed ? `show ${items.length}` : "hide"}
          </button>
        )}
        <button className={btn} onClick={() => void send()} disabled={!enabled || !text.trim() || busy === "send"}>
          {busy === "send" ? "sending…" : "send"}
        </button>
        <button className={btn} disabled title="pause / resume is a stretch goal">
          pause
        </button>
      </div>
    </div>
  );
}
