"""Validate candidate deltas without importing the agent, Gate, or GT reader."""

from copy import deepcopy
import os
import re

from review_models import HarnessPatch

SETTINGS = ("rules", "context_policy", "guardrails", "tool_access")


def apply_patches(parent, patches):
    if not patches:
        raise ValueError("A candidate needs at least one patch")
    settings = {key: deepcopy(parent[key]) for key in SETTINGS}
    seen = set()
    for raw in patches:
        patch = HarnessPatch.model_validate(raw)
        if patch.path in seen:
            raise ValueError("Patch each setting at most once per candidate")
        seen.add(patch.path)
        if os.getenv("EXECUTOR", "codex") == "codex" and patch.type == "context_policy":
            raise ValueError("M7 CLI candidates support tool_access, guardrail, and scoped rule patches")
        target = settings
        parts = patch.path.split(".")
        for part in parts[:-1]:
            target = target[part]
        if target[parts[-1]] != patch.from_value:
            raise ValueError(f"Stale patch from value: {patch.path}")
        if patch.type == "rule":
            # Scope is carried into the actual prompt, not just patch metadata.
            old, new = patch.from_value, patch.to
            if new[:len(old)] != old or len(new) <= len(old):
                raise ValueError("Scoped rule patches must append rules")
            for rule in new[len(old):]:
                if not rule.startswith(f"[{patch.scope}] ") or re.search(
                        r"workflow[ -]wide|all operations|every operation|entire workflow", rule, re.I):
                    raise ValueError("Rules must be explicitly limited to their operation scope")
        target[parts[-1]] = deepcopy(patch.to)
    return settings


def validate_candidate(document, parent):
    if document["status"] != "candidate" or document["eval"] is not None:
        raise ValueError("New harness versions must be unevaluated candidates")
    if document["parent_id"] != parent["_id"] or parent["status"] != "active":
        raise ValueError("Candidate parent must be the current active harness")
    expected = apply_patches(parent, document["patches"])
    if any(document[key] != expected[key] for key in SETTINGS):
        raise ValueError("Candidate settings must exactly match its validated patches")
    if not document["source_signals"] or len(set(document["source_signals"])) != len(document["source_signals"]):
        raise ValueError("Candidate needs distinct source signals")


def gate_payload(version, evaluation):
    rows = [evaluation["target"], *evaluation["regression"]]
    if len(rows) != 3 or len({row["protocol_id"] for row in rows}) != 3:
        raise ValueError("Gate requires a target and two distinct regression protocols")
    results = []
    for i, row in enumerate(rows):
        before, after = row["before"], row["after"]
        if not all(type(x) in (float, int) and 0 <= x <= 1 for x in (before, after)):
            raise ValueError("Gate scores must be structure_f1 values in [0, 1]")
        delta = round(after - before, 6)
        if row["delta"] != delta or row["role"] != ("target" if i == 0 else "regression"):
            raise ValueError("Gate result role/delta mismatch")
        results.append({k: row[k] for k in ("protocol_id", "role", "before", "after", "delta")})
    eligible = (results[0]["delta"] >= 0.05 and
                min(r["delta"] for r in results[1:]) >= -0.02 and
                all(row["status"] == "done" for row in rows))
    if evaluation["decision"] == "promote" and not eligible:
        raise ValueError("Gate cannot promote a failed run or a candidate below its thresholds")
    if evaluation["decision"] not in {"promote", "reject"}:
        raise ValueError("Invalid Gate decision")
    return {"version": version, "results": results, "decision": evaluation["decision"],
            "reason": evaluation["reason"]}
