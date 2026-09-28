"""Public wording for verifier findings; machine keys stay in stored events."""

import re


LABELS = {
    "graph_connected": "Connected workflow", "substrate_exists": "Molecule references",
    "oligos_represented": "Oligo coverage", "strand_consistency": "Strand consistency",
    "provenance_present": "Evidence and provenance", "benchmark_import": "Benchmark import",
    "missing_recoverable_information": "Missing recoverable information",
    "unsupported_completion": "Unsupported additions", "operation_error": "Operation error",
    "strand_or_orientation_error": "Strand or orientation error",
    "molecular_state_or_assembly_error": "Molecular structure error",
    "workflow_or_topology_error": "Workflow connections",
}


def public_check(check):
    value = dict(check)
    value["check"] = LABELS.get(check["check"], check["check"].replace("_", " ").capitalize())
    text = check["message"]
    # Imported checks used to prefix internal audit coordinates and append triage metadata.
    text = re.sub(r"^err_\d+\s*\(.*?\):\s*", "", text)
    text = re.sub(r"\s*Attribution:.*$", "", text)
    text = text.replace("Recoverable T3-linked oligo family", "An expected oligo family used by the workflow")
    text = re.sub(r"\b(Canonical typed edge|Predicted typed edge|Terminal output|Predicted terminal output|Transition|State)\s+(['\"])(.*?)\2", r"\1", text)
    text = re.sub(r"\s+(?:represented by|named)\s+['\"][\w.:-]*[_.:][\w.:-]*['\"]", "", text)
    text = re.sub(r"\s+['\"][\w.:-]*[_.:][\w.:-]*['\"]", "", text)
    text = re.sub(r"(?<!\w)(?:[A-Za-z]:)?/(?:[^\s,;]+/?)+", "the source document", text)
    text = re.sub(r"\b(?:err|oligo|state|transition|strand|segment|workflow)[_.:][\w.:-]+\b|\b[ST]\d+\b", "the referenced item", text)
    if check.get("state_id"):
        text = text.replace(check["state_id"], "this molecule")
    text = re.sub(r"\b(?:graph_connected|substrate_exists|oligos_represented|strand_consistency|provenance_present)\b", lambda m: LABELS[m[0]].lower(), text)
    text = text.replace("source_ref-linked", "source-linked")
    text = re.sub(r"\b\w+_\w+\b", "the referenced item", text)
    text = text.replace("Recoverable ", "Expected ").replace("ground truth", "reference")
    for old, new in {
        "Canonical typed edge": "A reference workflow connection",
        "Predicted typed edge": "A predicted workflow connection",
        "no matched canonical entity": "no match in the reference",
        "no canonical match": "no match in the reference",
        "different controlled functional role": "different functional role",
        "disagrees on recoverable content": "differs from the supported molecular structure",
        "matched neither scored nor neutral reference": "has no match in the reference",
    }.items():
        text = text.replace(old, new)
    value["message"] = text.strip()
    return value


def public_event(event):
    return public_check(event) if event["t"] == "verifier_check" else event


def public_workflow(workflow):
    return {**workflow, "checks": [public_check(c) for c in workflow["checks"]]} if workflow else None
