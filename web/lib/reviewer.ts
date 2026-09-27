"use client";
// lib/reviewer.ts — reviewer identity (SPEC.md §6): asked for on the first write, kept in
// localStorage, sent as X-Review-Token on write routes. The backend resolves the token to
// {id, name, role}; the name kept here is only for display before the first response.
import { useSyncExternalStore } from "react";

export interface ReviewerIdentity {
  name: string;
  token: string;
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
    return typeof v.token === "string" && v.token ? { name: typeof v.name === "string" ? v.name : "", token: v.token } : null;
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
