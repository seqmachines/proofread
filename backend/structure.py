"""Sequence-free Task 3 scoring primitives; no database or benchmark imports.

Reimplemented from LibStructBench's libgen/scoring.py and Task 3 schema.
Weights 0.15/0.20/0.15 are renormalized after removing reference sequence.
Ordered segment names replace the benchmark's segment sequence comparison.
This is structure_f1, not the paper's state F1. See M4_RESULTS.md.
"""

import re
from collections import Counter, defaultdict
from copy import deepcopy
from functools import lru_cache

from segments import role, words


def f1(overlap, predicted, truth):
    return 2 * overlap / (predicted + truth) if predicted + truth else 1.0


def bag_f1(a, b):
    a, b = Counter(a), Counter(b)
    return f1(sum((a & b).values()), sum(a.values()), sum(b.values()))


def match(scores, floor=0.0):
    """Exact partial assignment for the small seeded graphs (at most 11 states)."""
    if not scores or not scores[0]:
        return []
    if len(scores[0]) > len(scores):
        return sorted((j, i, s) for i, j, s in match(list(map(list, zip(*scores))), floor))

    @lru_cache(None)
    def solve(i, used):
        if i == len(scores):
            return 0.0, ()
        best, pairs = solve(i + 1, used)
        for j, value in enumerate(scores[i]):
            if used & (1 << j) or value < floor:
                continue
            tail, chosen = solve(i + 1, used | (1 << j))
            if value + tail > best:
                best, pairs = value + tail, ((i, j, value),) + chosen
        return best, pairs

    return list(solve(0, 0)[1])


def supported(item):
    return item.get("support_status", "explicit") in {"explicit", "derivable"}


def scorable(state):
    return supported(state) or any(supported(x) for key in
        ("strands", "paired_regions", "discontinuities") for x in state.get(key, []))


def project_state(state):
    """Keep both bottom listing directions for scoring; never alter run data."""
    if state.get("benchmark_structure") is not None:
        # Imported assemblies carry their complete, sequence-free structure.
        # The two display rows can be only a preview of a larger assembly.
        return deepcopy(state["benchmark_structure"])
    projected = _project_state(state)
    if len(state["strands"]["bottom"]) > 1:
        alternative = deepcopy(state)
        alternative["strands"]["bottom"].reverse()
        projected["_bottom_reversed"] = _project_state(alternative)
    return projected


def _project_state(state):
    """Infer only what §2.1's two aligned strands can express, without GT."""
    rows = state["strands"]
    rna = bool(re.search(r"\b(?:mRNA|RNA)\b", state["label"], re.I))
    strands = []
    for side in ("top", "bottom"):
        if not rows[side]:
            continue
        segments = rows[side] if side == "top" else list(reversed(rows[side]))
        strands.append({"strand_id": side, "molecule_type": "RNA" if side == "top" and rna else "DNA",
                        "orientation": "5_to_3", "segments": [
            {"segment_id": f"{side}:{i}", "role": role(s["name"], s["type"]),
             "structural_role": "unpaired"} for i, s in enumerate(segments)]})
    regions = []
    if len(strands) == 2:
        left, right = strands
        # A primer's tail can anneal to poly(A); unrepresented handles are not invented.
        equivalent = lambda x: "poly_tail" if x == "oligo_dt" else x
        a, b = left["segments"], right["segments"]
        pairs = match([[float(equivalent(x["role"]) == equivalent(y["role"]))
                        for y in b] for x in a], floor=1.0)
        for i, j, _ in pairs:
            a[i]["structural_role"] = b[j]["structural_role"] = "paired_region"
            regions.append({"relationship": "reverse_complementary",
                            "side_1": {"strand_id": "top", "segment_ids": [a[i]["segment_id"]]},
                            "side_2": {"strand_id": "bottom", "segment_ids": [b[j]["segment_id"]]}})
        for strand in strands:
            paired = [i for i, s in enumerate(strand["segments"]) if s["structural_role"] == "paired_region"]
            for i, seg in enumerate(strand["segments"]):
                if paired and seg["structural_role"] != "paired_region":
                    seg["structural_role"] = ("five_prime_overhang" if i < min(paired) else
                                              "three_prime_overhang" if i > max(paired) else "internal_unpaired")
    architecture = "single_stranded"
    if len(strands) == 2:
        architecture = "rna_dna_hybrid" if rna else "double_stranded"
        if not rna and any(s["structural_role"] != "paired_region" for st in strands for s in st["segments"]):
            architecture = "partially_duplex"
    return {"state_id": state["id"], "strand_architecture": architecture,
            "strands": strands, "paired_regions": regions, "discontinuities": []}


def project_workflow(workflow):
    transitions = [{"transition_id": t["id"], "operation": t["op"],
                    "substrate_state_ids": [t["from"]],
                    "product_state_ids": [t["to"], *t.get("discarded", [])],
                    "carried_forward_product_ids": [t["to"]],
                    "discarded_product_ids": t.get("discarded", []),
                    "oligo_ids": t.get("oligos", [])} for t in workflow["transitions"]]
    return {"states": [project_state(s) for s in workflow["states"]], "transitions": transitions}


def strand_similarity(a, b):
    aa, bb = a["segments"], b["segments"]
    # Preserve positions: no unordered bag or sequence term in segment reward.
    score = sum(.75 * (role(x["role"]) == role(y["role"])) +
                .25 * (x["structural_role"] == y["structural_role"]) for x, y in zip(aa, bb))
    return (.75 * f1(score, len(aa), len(bb)) +
            .15 * (a["molecule_type"] == b["molecule_type"]) +
            .10 * (a["orientation"] == b["orientation"]))


def pairing_descriptors(state, support=None):
    strands = {s["strand_id"]: s for s in state["strands"]}
    segments = {s["segment_id"]: (s["structural_role"], role(s["role"]))
                for strand in strands.values() for s in strand["segments"]}
    groups = defaultdict(list)
    for region in state.get("paired_regions", []):
        if support is not None and supported(region) != support:
            continue
        pair = tuple(sorted(region[k]["strand_id"] for k in ("side_1", "side_2")))
        groups[(region["relationship"], pair)].append(region)
    result = []
    for (relationship, pair), regions in groups.items():
        coverage = {sid: {s for r in regions for k in ("side_1", "side_2")
                         if r[k]["strand_id"] == sid for s in r[k]["segment_ids"]} for sid in pair}
        expected = {sid: {s["segment_id"] for s in strands[sid]["segments"]
                          if s["structural_role"] == "paired_region"} for sid in pair}
        if all(expected[sid] and coverage[sid] == expected[sid] for sid in pair):
            result.append(("complete", relationship, tuple(sorted(strands[sid]["molecule_type"] for sid in pair))))
        else:
            for r in regions:
                sides = [(strands[r[k]["strand_id"]]["molecule_type"],
                          tuple(segments[s] for s in r[k]["segment_ids"])) for k in ("side_1", "side_2")]
                result.append((relationship, tuple(sorted(sides))))
    gaps = [(d["kind"], segments.get(d.get("after_segment_id")), segments.get(d.get("before_segment_id")))
            for d in state.get("discontinuities", []) if support is None or supported(d) == support]
    return result, gaps


def state_similarity(a, b, scorable_only=True):
    variants = [a]
    if "_bottom_reversed" in a:
        variants.append(a["_bottom_reversed"])
    return max(_state_similarity(v, b, scorable_only) for v in variants)


def _state_similarity(a, b, scorable_only=True):
    aa = a["strands"]
    bb = [s for s in b["strands"] if not scorable_only or supported(s)]
    if scorable_only:
        aa = list(aa)
        for neutral in (s for s in b["strands"] if not supported(s)):
            for i, s in enumerate(aa):
                if strand_similarity(s, neutral) == 1:
                    aa.pop(i)
                    break
    n, m = len(a["strands"]), len(b["strands"])
    architecture = ((a["strand_architecture"] == b["strand_architecture"]) +
                    (min(n, m) / max(n, m) if n or m else 1) +
                    bag_f1([s["molecule_type"] for s in a["strands"]],
                           [s["molecule_type"] for s in b["strands"]])) / 3
    pairs = match([[strand_similarity(x, y) for y in bb] for x in aa])
    segments = f1(sum(v for _, _, v in pairs), len(aa), len(bb))
    pa = pairing_descriptors(a)
    pb = pairing_descriptors(b, True if scorable_only else None)
    neutral = pairing_descriptors(b, False) if scorable_only else ([], [])
    pairing = sum(bag_f1(list((Counter(x) - Counter(z)).elements()), y)
                  for x, y, z in zip(pa, pb, neutral)) / 2
    dims = [(.15, architecture, supported(b)),
            (.20, segments, any(supported(s) for s in b["strands"])),
            (.15, pairing, supported(b) or any(supported(s) for key in ("paired_regions", "discontinuities") for s in b.get(key, [])))]
    enabled = [(w, value) for w, value, on in dims if on or not scorable_only]
    return sum(w * v for w, v in enabled) / sum(w for w, _ in enabled) if enabled else 0.0


def op_class(op):
    for group in ({"extension", "strand_synthesis"}, {"pcr", "amplification", "indexing"},
                  {"capture", "affinity_selection"}, {"fragmentation", "tagmentation"}):
        if op in group:
            return sorted(group)[0]
    return op


HANDLING = {"cleanup", "size_selection", "sample_split", "pooling", "other"}


def contexts(workflow):
    context = {s["state_id"]: {"incoming": [], "outgoing": []} for s in workflow["states"]}
    for t in workflow["transitions"]:
        for field, direction in (("substrate_state_ids", "outgoing"), ("product_state_ids", "incoming")):
            for sid in t[field]:
                if sid in context:
                    context[sid][direction].append(op_class(t["operation"]))
    initial = set(workflow.get("initial_state_ids", [s for s, c in context.items() if not c["incoming"]]))
    terminal = {s["state_id"] for s in workflow["final_outputs"]} if "final_outputs" in workflow else {
        s for s, c in context.items() if not c["outgoing"]}
    return context, {s: (s in initial, s in terminal) for s in context}


def typed_edges(workflow, support=None):
    edges = set()
    for t in workflow["transitions"]:
        if support is not None and supported(t) != support:
            continue
        tid = t["transition_id"]
        edges.update(("substrate", s, tid) for s in t["substrate_state_ids"])
        edges.update(("carried_product", tid, s) for s in t["carried_forward_product_ids"])
        edges.update(("discarded_product", tid, s) for s in t["discarded_product_ids"])
    return edges


def score(prediction, truth):
    """Soft state F1, exact typed-edge F1 after independent entity alignment."""
    pc, pb = contexts(prediction)
    tc, tb = contexts(truth)
    ps, ts = prediction["states"], truth["states"]
    scientific = [[state_similarity(p, t, False) for t in ts] for p in ps]
    assignment = []
    for i, p in enumerate(ps):
        row = []
        for j, t in enumerate(ts):
            a, b = pc[p["state_id"]], tc[t["state_id"]]
            claims = [(2 if d == "incoming" else 1, bag_f1(a[d], b[d])) for d in a if b[d]]
            event = sum(w * v for w, v in claims) / sum(w for w, _ in claims) if claims else 1
            value = (scientific[i][j] + .1 * (pb[p["state_id"]] == tb[t["state_id"]]) + .15 * event) / 1.25
            if a["incoming"] and b["incoming"] and not set(a["incoming"]) & set(b["incoming"]) and not (set(a["incoming"] + b["incoming"]) & HANDLING):
                value -= .25
            elif b["incoming"] and not a["incoming"] and pb[p["state_id"]][0] and not tb[t["state_id"]][0]:
                value -= .15
            if not {s["molecule_type"] for s in p["strands"]} & {s["molecule_type"] for s in t["strands"]}:
                value = 0
            row.append(max(0, value))
        assignment.append(row)
    pairs = match(assignment, .25)
    state_map = {ps[i]["state_id"]: ts[j]["state_id"] for i, j, _ in pairs}
    neutral_count = sum(not scorable(ts[j]) for _, j, _ in pairs)
    total = sum(state_similarity(ps[i], ts[j]) for i, j, _ in pairs if scorable(ts[j]))
    structure_f1 = f1(total, len(ps) - neutral_count, sum(scorable(t) for t in ts))

    def transition_similarity(a, b):
        mapped = lambda field: bag_f1([state_map.get(s, ("unmatched", s)) for s in a[field]], b[field])
        operation = float(a["operation"] == b["operation"] or {a["operation"], b["operation"]} <= {"extension", "strand_synthesis"})
        oligos = bag_f1([role(x) for x in a["oligo_ids"]], [role(x) for x in b["oligo_ids"]])
        value = (.3 * operation + .15 * mapped("substrate_state_ids") + .2 * mapped("product_state_ids") +
                 .15 * (mapped("carried_forward_product_ids") + mapped("discarded_product_ids")) / 2 + .2 * oligos)
        value = (value + .15 * max(operation, oligos if b["oligo_ids"] else 0)) / 1.15
        if op_class(a["operation"]) != op_class(b["operation"]):
            value -= .15 if (a["operation"] in HANDLING) != (b["operation"] in HANDLING) else .2
        return max(0, value)

    pt, tt = prediction["transitions"], truth["transitions"]
    transition_pairs = match([[transition_similarity(a, b) for b in tt] for a in pt], .25)
    transition_map = {pt[i]["transition_id"]: tt[j]["transition_id"] for i, j, _ in transition_pairs}
    predicted_edges, truth_edges, neutral_edges = typed_edges(prediction), typed_edges(truth, True), typed_edges(truth, False)
    mapped = {e: (e[0], state_map.get(e[1]), transition_map.get(e[2])) if e[0] == "substrate" else
                 (e[0], transition_map.get(e[1]), state_map.get(e[2])) for e in predicted_edges}
    hits = set(mapped.values()) & truth_edges
    ignored = set(mapped.values()) & neutral_edges
    edge_f1 = f1(len(hits), len(predicted_edges) - len(ignored), len(truth_edges))
    missing = [s["state_id"] for s in ts if scorable(s) and s["state_id"] not in state_map.values()]
    extra = [s["state_id"] for s in ps if s["state_id"] not in state_map]
    edge_doc = lambda e: {"type": e[0], "from": e[1], "to": e[2]}
    return {"structure_f1": round(structure_f1, 6), "edge_f1": round(edge_f1, 6)}, {
        "missing_states": missing, "extra_states": extra,
        "missing_edges": [edge_doc(e) for e in sorted(truth_edges - hits)],
        "extra_edges": [edge_doc(e) for e in sorted(predicted_edges) if mapped[e] not in truth_edges | neutral_edges]}, [
        {"state_id": ps[i]["state_id"], "truth_id": ts[j]["state_id"],
         "similarity": round(state_similarity(ps[i], ts[j]), 6) if scorable(ts[j]) else None}
        for i, j, _ in pairs]
