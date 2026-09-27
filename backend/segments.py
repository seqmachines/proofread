"""Shared symbolic aliases and bottom-row convention detection; no database access."""

import re


def words(value):
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def role(name, kind=""):
    """Conservative symbolic aliases; never split one segment into several."""
    text = words(name)
    if kind == "insert":
        return "insert"
    for pattern, result in [
        (r"\btso\b|template switch", "tso"),
        (r"\bp5\b", "p5"), (r"\bp7\b", "p7"),
        (r"\bi5\b|index 2|n s5|n5xx", "i5"),
        (r"\bi7\b|index 1|n7xx", "i7"),
        (r"mosaic|transposon|tn5", "tn5_adapter"),
        (r"oligo dt|oligo d t|oligodt", "oligo_dt"),
        (r"ispcr|common primer|shared primer|universal.*anchor", "ispcr"),
        (r"poly a\b|polya\b|poly da\b|poly t\b|poly dt\b|polyt\b|poly tail\b", "poly_tail"),
        (r"\bvn\b|anchor bases", "anchor"),
        (r"c tail|untemplated.*extension", "c_tail"),
        (r"cdna|mrna|transcript|genomic|insert", "insert"),
        (r"read 1|r1\b", "read1"), (r"read 2|r2\b", "read2"),
    ]:
        if re.search(pattern, text):
            return result
    return re.sub(r"\b(complementary|complement|reverse|derived|strand)\b", "", text).strip()


def bottom_is_5to3(state):
    """Detect reversal only when distinct, unique anchors resolve the direction."""
    top = [role(s["name"], s["type"]) for s in state["strands"]["top"]]
    bottom = [role(s["name"], s["type"]) for s in state["strands"]["bottom"]]
    shared = {s for s in top if top.count(s) == bottom.count(s) == 1}
    a, b = [s for s in top if s in shared], [s for s in bottom if s in shared]
    return len(shared) >= 2 and a != b and a == list(reversed(b))
