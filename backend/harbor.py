"""Pure mapping of saved Harbor trajectories. Never execute recorded commands."""

import ast
from copy import deepcopy
import hashlib
import json
import re


NORMALIZATION_VERSION = "m14.2"
SEQUENCE = re.compile(r"(?<![A-Za-z])[ACGTUNacgtun]{10,}(?![A-Za-z])")
SECRET = re.compile(
    r"(?i)(?:\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,})|"
    r"(?:api[_-]?key|access[_-]?token|password|authorization)\s*[:=]\s*[^\s,;]+|"
    r"(?:mongodb(?:\+srv)?|https?)://[^\s/@]+:[^\s/@]+@[^\s]+)"
)
PATH = re.compile(r"/(?:workspace|tmp|logs)/[^\s'\"`<>|;,(){}\[\]\\]+")
READ = re.compile(
    r"\b(?:cat|sed|head|tail|rg|grep|pdftotext|pdfinfo)\s|"
    r"\.(?:read_text|read_bytes|get_text|extract_text|glob)\(|"
    r"\b(?:open|PdfReader|load_workbook)\(|\bview_image\("
)
ASSUMPTION = re.compile(r"(?i)^(?:[-*]\s*)?(?:assumptions?\s*:|(?:I|we)\s+(?:assume|am assuming|are assuming)\b|assuming\b)")


def link_state_evidence(events):
    """Fill imported commits from prior reads; preserve explicit evidence edits.

    Return a copied event stream and its final state evidence. Review documents
    stay untouched; replay before/after payloads inherit the added citations
    only when the original edit left evidence unchanged.
    """
    reads, linked, original, result = [], {}, {}, []
    for raw in events:
        event = deepcopy(raw)
        if event["t"] == "evidence_searched":
            ids = list(dict.fromkeys(hit["chunk_id"] for hit in event["results"]))
            if ids:
                reads = [ids, *reads[:2]]
        elif event["t"] == "state_committed":
            state = event["state"]
            original[state["id"]] = list(state["evidence"])
            if not state["evidence"]:
                state["evidence"] = list(dict.fromkeys(cid for hits in reads for cid in hits))
            linked[state["id"]] = list(state["evidence"])
        elif event["t"] == "state_revised":
            sid, before, after = event["state_id"], event["before"], event["after"]
            if before is not None and sid in linked and before["evidence"] == original[sid]:
                if after is not None and after["evidence"] == before["evidence"]:
                    after["evidence"] = list(linked[sid])
                before["evidence"] = list(linked[sid])
            if after is None:
                original.pop(sid, None)
                linked.pop(sid, None)
            else:
                original[sid] = list(raw["after"]["evidence"])
                linked[sid] = list(after["evidence"])
        result.append(event)
    return result, linked


def clean(text, limit=12000):
    text = SECRET.sub("[credential omitted]", str(text))
    text = re.sub(r"data:image/[^\s'\"]+", "[image omitted]", text)
    text = SEQUENCE.sub("[sequence omitted]", text)
    return text.strip()[:limit]


def observation_text(content):
    """Harbor Codex observations contain Python reprs of content blocks."""
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except ValueError:
            try:
                content = ast.literal_eval(content)
            except (ValueError, SyntaxError, RecursionError):
                return content
    if isinstance(content, list):
        return "\n".join(observation_text(block) for block in content)
    if isinstance(content, dict):
        if content.get("type") in {"image", "input_image"}:
            return ""
        return str(content.get("text", content.get("output", ""))).replace("\\n", "\n").replace("\\t", "\t")
    return ""


def map_trajectory(raw, source_path, protocol_id):
    """Archive only public text excerpts, mapped events, and source hashes.

    Original files can exceed MongoDB's 16 MB document limit due to images.
    The mapping is self-contained; image data and executable code stay on disk.
    A page value of 0 means the recorded read did not identify a page.
    """
    data = json.loads(raw)
    if not isinstance(data.get("steps"), list):
        raise ValueError("Harbor trajectory must contain a steps array")
    events, chunks = [], []
    for step in data["steps"]:
        if step.get("source") != "agent":
            continue
        step_id = step["step_id"]
        message = clean(step.get("message", ""), 4000)
        if message:
            events.append({"t": "step_started", "step": step_id, "goal": message})
            for sentence in re.split(r"\n+|(?<=[.!?])\s+", message):
                if ASSUMPTION.search(sentence.strip()):
                    events.append({"t": "assumption", "text": sentence.strip()})
        observations = (step.get("observation") or {}).get("results", [])
        for call in step.get("tool_calls") or []:
            name = call["function_name"].split(".")[-1]
            args = call.get("arguments") or {}
            code = args.get("input", args.get("cmd", "")) if isinstance(args, dict) else str(args)
            direct = name in {"read_file", "read_page", "view_image"}
            if not direct and not (name in {"exec", "exec_command"} and READ.search(code)
                    and (name == "exec_command" or re.search(r"tools\.(?:exec_command|view_image)\(", code))):
                continue
            outputs = [observation_text(o.get("content", "")) for o in observations
                       if o.get("source_call_id") == call["tool_call_id"]]
            output = "\n".join(outputs)
            # Do not invent evidence when a call has no recorded text result.
            if not output.strip() or not re.sub(r"Script completed.*?Output:\s*", "", output, flags=re.S).strip():
                continue
            paths = sorted({clean(p, 240) for p in PATH.findall(code if not direct else json.dumps(args))
                            if re.search(r"\.(?:pdf|xlsx?|txt|md|json|py|csv|tsv|png)$", p, re.I)})
            label = ", ".join(paths) or "file contents"
            query = clean(f"Read {label} (Harbor step {step_id})", 600)
            text = clean(re.sub(r"Script completed\nWall time[^\n]*\nOutput:\s*", "", output), 12000)
            page_match = re.search(r"(?im)^\s*(?:=+\s*)?(?:[\w -]*\s)?PAGE\s+(\d+)\b", text)
            page = int(page_match[1]) if page_match else 0
            key = hashlib.sha256(f"{source_path}:{step_id}:{call['tool_call_id']}".encode()).hexdigest()[:16]
            chunk_id = f"{protocol_id}:harbor:{key}"
            chunks.append({"_id": chunk_id, "protocol_id": protocol_id, "page": page,
                           "kind": "page", "source_file": label, "text": text,
                           "provenance": {"trajectory": source_path, "step_id": step_id,
                                          "tool_call_id": call["tool_call_id"]}})
            events.append({"t": "evidence_searched", "query": query,
                           "results": [{"chunk_id": chunk_id, "page": page, "snippet": text[:400]}]})
    return {"path": source_path, "sha256": hashlib.sha256(raw.encode()).hexdigest(),
            "normalization_version": NORMALIZATION_VERSION, "events": events, "chunks": chunks}
