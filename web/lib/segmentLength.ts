// lib/segmentLength.ts — how long is a segment, and how wide should its block be?
//
// The agent's result JSON carries real sequences for defined segments (barcodes, UMIs,
// primers) and placeholders for variable regions (the mRNA body, the insert). The §2.1
// Segment the backend sends has no length yet, so this estimates one: an explicit
// `length` wins, then a number written in the name ("16-nt cell barcode"), then the
// segment's kind. Widths follow sqrt(length): a 300-nt insert reads as the longest block
// without flattening an 8-nt index into a sliver, and the two strands of a state share
// one width per alignment column so paired segments stay in register.
import type { Segment } from "./events";
import type { Column } from "./strandAlign";

const BY_TYPE: Record<string, number> = {
  index: 8,
  umi: 12,
  barcode: 16,
  primer: 22,
  handle: 22,
  tso: 30,
  polyA: 30,
  adapter: 34,
  insert: 300,
  other: 25,
};

const HINTS: [RegExp, number][] = [
  [/non.?templated|terminal cytosines|\bccc\b|\bggg\b|\brg{2,}\b/i, 3],
  [/\bspacer\b/i, 10],
  [/poly.?\(?[dt]?[at]\)?|oligo.?dt/i, 30],
  [/read ?[12]|scaffold|p[57]\b|adapter|tn5|mosaic/i, 34],
  [/insert|body|cdna|mrna|transcript|genomic|fragment|dna copy|template/i, 300],
];

export function estimateLength(seg: Segment & { length?: number | null }): number {
  if (typeof seg.length === "number" && seg.length > 0) return seg.length;
  const m = seg.name.match(/(\d+)\s*-?\s*(?:nt|bp|mer|nucleotide|base)/i);
  if (m) return Number(m[1]);
  const hint = HINTS.find(([re]) => re.test(seg.name));
  if (hint) return hint[1];
  return BY_TYPE[seg.type] ?? BY_TYPE.other;
}

export const MIN_W = 14;
const FLOORS = [10, 8, 6]; // narrowest a column may be squeezed to, relaxed pass by pass
export const MAX_W = 150;
export const widthFor = (len: number) => Math.max(MIN_W, Math.min(MAX_W, Math.round(12 + 5 * Math.sqrt(len))));

/**
 * One width per alignment column (lib/strandAlign.ts), shared by both strands and scaled
 * to fit maxTotal. A column is as wide as the longer of its two segments.
 */
export function columnWidths(columns: Column[], top: Segment[], bottom: Segment[], maxTotal = 250): number[] {
  const of = (seg: Segment | undefined) => (seg ? widthFor(estimateLength(seg)) : 0);
  let w = columns.map((c) => Math.max(of(c.top === null ? undefined : top[c.top]), of(c.bottom === null ? undefined : bottom[c.bottom]), MIN_W));
  // Scaling can leave the total over the limit once narrow columns hit the floor, so repeat with a lower one.
  for (const floor of FLOORS) {
    const total = w.reduce((s, x) => s + x, 0);
    if (total <= maxTotal) break;
    const k = maxTotal / total;
    w = w.map((x) => Math.max(floor, Math.floor(x * k)));
  }
  return w;
}
