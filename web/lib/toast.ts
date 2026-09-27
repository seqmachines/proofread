"use client";
// lib/toast.ts — tiny error/info toast store (no provider needed; <Toaster /> lives in the root layout).
import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  kind: "error" | "info";
  text: string;
}

let toasts: Toast[] = [];
const EMPTY: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string, kind: Toast["kind"] = "error", ttlMs = 6000): number {
  const id = nextId++;
  toasts = [...toasts.slice(-4), { id, kind, text }];
  emit();
  if (ttlMs > 0) setTimeout(() => dismissToast(id), ttlMs);
  return id;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => EMPTY,
  );
}
