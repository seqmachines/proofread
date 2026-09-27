// lib/colors.ts — SPEC.md §2.7 segment colors, exactly. Web only.
import type { SegmentType } from "./events";

export const SEGMENT_COLORS: Record<SegmentType, string> = {
  adapter: "#6B7280",
  barcode: "#2563EB",
  umi: "#7C3AED",
  insert: "#059669",
  primer: "#D97706",
  tso: "#DC2626",
  handle: "#0891B2",
  index: "#DB2777",
  polyA: "#65A30D",
  other: "#9CA3AF",
};

export const SEGMENT_TYPES = Object.keys(SEGMENT_COLORS) as SegmentType[];

function luminance(hex: string): number {
  const c = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
}

/** Text color that stays legible on a segment block (dark on primer/polyA/other, white elsewhere). */
export const SEGMENT_TEXT: Record<SegmentType, string> = Object.fromEntries(
  SEGMENT_TYPES.map((t) => [t, luminance(SEGMENT_COLORS[t]) > 0.25 ? "#111827" : "#FFFFFF"]),
) as Record<SegmentType, string>;

export function segmentColor(type: string): string {
  return (SEGMENT_COLORS as Record<string, string>)[type] ?? SEGMENT_COLORS.other;
}

export function segmentText(type: string): string {
  return (SEGMENT_TEXT as Record<string, string>)[type] ?? SEGMENT_TEXT.other;
}

/** Best-effort segment type for an oligo named in a transition ("TSO", "P5 primer", "i7 index primer"). */
export function guessSegmentType(name: string): SegmentType {
  const n = name.toLowerCase();
  if (/tso|template.?switch/.test(n)) return "tso";
  if (/\bumi\b/.test(n)) return "umi";
  if (/barcode|\bbc\b|\bcb\b/.test(n)) return "barcode";
  if (/index|\bi[57]\b/.test(n)) return "index";
  if (/adapt|\bp[57]\b|read ?[12]/.test(n)) return "adapter";
  if (/primer|oligo.?d?t|poly.?\(?d?t/.test(n)) return "primer";
  if (/handle|anchor/.test(n)) return "handle";
  return "other";
}
