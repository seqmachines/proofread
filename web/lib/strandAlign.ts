// lib/strandAlign.ts — which top segment sits over which bottom segment.
//
// §2.1 lists top 5'→3' and bottom 3'→5' "aligned under top", but the two lists carry no
// positions: with an overhang they differ in length, and pairing them by list index
// shifts everything after it. This module assigns columns instead.
//   exact:    imported states keep the native structure (benchmark_structure), whose
//             paired_regions say which segments pair. An unpaired segment gets a column
//             of its own, so nothing unpaired is drawn as if it paired.
//   inferred: otherwise an order-preserving alignment over "could these two pair?"
//             (same role, else same type). Leftovers stack outward from the nearest
//             pair, which is the old by-index layout when nothing is recognisable.
// Display only: similarity and scores stay the backend's.
import type { MoleculeState, Segment } from "./events";

/** One drawing column: an index into strands.top and/or strands.bottom. */
export interface Column {
  top: number | null;
  bottom: number | null;
}

type Strands = Pick<MoleculeState, "strands" | "benchmark_structure">;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Port of backend/segments.py role(): conservative symbolic aliases, first match wins.
const ROLES: [RegExp, string][] = [
  [/\btso\b|template switch/, "tso"],
  [/\bp5\b/, "p5"],
  [/\bp7\b/, "p7"],
  [/\bi5\b|index 2|n s5|n5xx/, "i5"],
  [/\bi7\b|index 1|n7xx/, "i7"],
  [/mosaic|transposon|tn5/, "tn5_adapter"],
  [/oligo dt|oligo d t|oligodt/, "oligo_dt"],
  [/ispcr|common primer|shared primer|universal.*anchor/, "ispcr"],
  [/poly a\b|polya\b|poly da\b|poly t\b|poly dt\b|polyt\b|poly tail\b/, "poly_tail"],
  [/\bvn\b|anchor bases/, "anchor"],
  [/c tail|untemplated.*extension/, "c_tail"],
  [/cdna|mrna|transcript|genomic|insert/, "insert"],
  [/read 1|r1\b/, "read1"],
  [/read 2|r2\b/, "read2"],
];

/** What a segment is, independent of how each side happened to name it. */
export function roleKey(seg: Pick<Segment, "name" | "type">): string {
  if (seg.type === "insert") return "insert";
  const text = words(seg.name);
  const hit = ROLES.find(([re]) => re.test(text));
  if (hit) return hit[1];
  return text.replace(/\b(complementary|complement|reverse|derived|strand)\b/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Order-preserving pairs (i, j) with the highest total score; a score of 0 never pairs.
 * Ties pair as far left as possible.
 */
export function alignPairs<A, B>(a: A[], b: B[], score: (x: A, y: B) => number): [number, number][] {
  const n = a.length;
  const m = b.length;
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = score(a[i], b[j]);
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], s > 0 ? s + best[i + 1][j + 1] : 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = score(a[i], b[j]);
    if (s > 0 && best[i][j] === s + best[i + 1][j + 1]) pairs.push([i++, j++]);
    else if (best[i][j] === best[i + 1][j]) i++;
    else j++;
  }
  return pairs;
}

interface Keyed {
  role: string;
  type: string;
}
const keyed = (s: Segment): Keyed => ({ role: roleKey(s), type: s.type });
// The backend's own pairing rule (structure.py _project_state): a primer's oligo-dT anneals to poly(A).
const annealed = (role: string) => (role === "oligo_dt" ? "poly_tail" : role);
const pairScore = (a: Keyed, b: Keyed) =>
  a.role !== "" && annealed(a.role) === annealed(b.role) ? 3 : a.type !== b.type ? 0 : a.type === "other" ? 1 : 2;

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/** Columns for `pairs`; the unpaired runs between them either stack by position or stand alone. */
function columnsFromPairs(n: number, m: number, pairs: [number, number][], stack: boolean): Column[] {
  const cols: Column[] = [];
  let i = 0;
  let j = 0;
  const gap = (toI: number, toJ: number, towards: "left" | "right") => {
    const a = range(i, toI);
    const b = range(j, toJ);
    if (stack) {
      const k = Math.max(a.length, b.length);
      for (let c = 0; c < k; c++) {
        const top = a[towards === "right" ? c - (k - a.length) : c] ?? null;
        const bottom = b[towards === "right" ? c - (k - b.length) : c] ?? null;
        cols.push({ top, bottom });
      }
    } else {
      for (const top of a) cols.push({ top, bottom: null });
      for (const bottom of b) cols.push({ top: null, bottom });
    }
  };
  pairs.forEach(([pi, pj], k) => {
    gap(pi, pj, k === 0 ? "right" : "left"); // before the first pair, overhangs extend outward
    cols.push({ top: pi, bottom: pj });
    i = pi + 1;
    j = pj + 1;
  });
  gap(n, m, "left");
  return cols;
}

interface Side {
  strand_id: string;
  segment_ids: string[];
}
const asSide = (x: unknown): Side | null => {
  if (typeof x !== "object" || x === null) return null;
  const s = x as { strand_id?: unknown; segment_ids?: unknown };
  return typeof s.strand_id === "string" && Array.isArray(s.segment_ids) && s.segment_ids.every((id) => typeof id === "string")
    ? { strand_id: s.strand_id, segment_ids: s.segment_ids as string[] }
    : null;
};

/**
 * Pairs declared by the native structure, or null when the two drawn rows do not resolve
 * to it. The rows are built by backend/seed.py convert_ground_truth: top is the reference
 * strand, bottom is its first pairing partner listed in reverse.
 */
function declaredPairs(state: Strands): [number, number][] | null {
  const bs = state.benchmark_structure;
  const { top, bottom } = state.strands;
  if (!bs || !Array.isArray(bs.paired_regions) || bottom.length === 0) return null;
  const T = bs.strands.find((s) => s.strand_id === bs.reference_strand_id);
  if (!T || T.segments.length !== top.length) return null;
  const regions = bs.paired_regions.flatMap((r) => {
    const o = (typeof r === "object" && r !== null ? r : {}) as { side_1?: unknown; side_2?: unknown };
    const a = asSide(o.side_1);
    const b = asSide(o.side_2);
    return a && b ? [[a, b] as const] : [];
  });
  const partners = new Set(regions.flatMap(([a, b]) => (a.strand_id === T.strand_id ? [b.strand_id] : b.strand_id === T.strand_id ? [a.strand_id] : [])));
  const B = bs.strands.find((s) => s !== T && partners.has(s.strand_id));
  if (!B || B.segments.length !== bottom.length) return null;
  const topAt = new Map(T.segments.map((s, i) => [s.segment_id, i]));
  const bottomAt = new Map(B.segments.map((s, i) => [s.segment_id, B.segments.length - 1 - i]));
  const at = (side: Side, index: Map<string, number>) =>
    side.segment_ids.flatMap((id) => (index.has(id) ? [index.get(id)!] : [])).sort((x, y) => x - y);
  const pairs: [number, number][] = [];
  for (const [a, b] of regions) {
    const [t, p] = a.strand_id === T.strand_id && b.strand_id === B.strand_id ? [a, b] : b.strand_id === T.strand_id && a.strand_id === B.strand_id ? [b, a] : [null, null];
    if (!t || !p) continue;
    const ti = at(t, topAt);
    const bi = at(p, bottomAt);
    for (let k = 0; k < Math.min(ti.length, bi.length); k++) pairs.push([ti[k], bi[k]]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  // Columns need one left-to-right order: no crossing pairs, no segment used twice.
  for (let k = 1; k < pairs.length; k++) {
    if (pairs[k][0] <= pairs[k - 1][0] || pairs[k][1] <= pairs[k - 1][1]) return null;
  }
  return pairs.length > 0 ? pairs : null;
}

const cache = new WeakMap<object, Column[]>();

/** Drawing columns for a state's two strands; every segment appears in exactly one. */
export function alignStrands(state: Strands): Column[] {
  const hit = cache.get(state.strands);
  if (hit) return hit;
  const { top, bottom } = state.strands;
  const declared = declaredPairs(state);
  const cols = declared
    ? columnsFromPairs(top.length, bottom.length, declared, false)
    : columnsFromPairs(top.length, bottom.length, alignPairs(top.map(keyed), bottom.map(keyed), pairScore), true);
  cache.set(state.strands, cols);
  return cols;
}
