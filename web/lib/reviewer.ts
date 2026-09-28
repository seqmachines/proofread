"use client";
// lib/reviewer.ts — reviewer identity (SPEC.md §6): asked for on the first write, kept in
// localStorage, sent as X-Review-Token on write routes. The backend resolves the token to
// {id, name, role}; the name kept here is only for display before the first response.
import { useSyncExternalStore } from "react";

export interface ReviewerIdentity {
  name: string;
  token: string;
  role?: "curator" | "author"; // learned from an invite link or the first review_recorded
  protocol_id?: string; // authors: the one protocol the token can write to
}

const KEY = "proofread.reviewer";
const listeners = new Set<() => void>();
let cached: ReviewerIdentity | null | undefined; // undefined = not read yet

function read(): ReviewerIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ReviewerIdentity>;
    if (typeof v.token !== "string" || !v.token) return null;
    return {
      name: typeof v.name === "string" ? v.name : "",
      token: v.token,
      role: v.role === "author" || v.role === "curator" ? v.role : undefined,
      protocol_id: typeof v.protocol_id === "string" ? v.protocol_id : undefined,
    };
  } catch {
    return null;
  }
}

export function getReviewer(): ReviewerIdentity | null {
  if (cached === undefined) cached = read();
  return cached;
}

export function setReviewer(r: ReviewerIdentity | null) {
  cached = r;
  try {
    if (r) window.localStorage.setItem(KEY, JSON.stringify(r));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: identity lives for this page only */
  }
  listeners.forEach((l) => l());
}

export function useReviewer(): ReviewerIdentity | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getReviewer,
    () => null,
  );
}

/** Curator-only UI (harness changes, invites, verify / adjudicate) hides for authors. */
export const isAuthor = (r: ReviewerIdentity | null) => r?.role === "author";
