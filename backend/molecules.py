"""The symbolic §2.1 contract and tool argument validation."""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, AfterValidator


def symbolic(value: str) -> str:
    if re.search(r"(?i)(?<![a-z])[acgtun]{10,}(?![a-z])", value):
        raise ValueError("Use symbolic segment names, never nucleotide strings")
    return value


Text = Annotated[str, Field(min_length=1), AfterValidator(symbolic)]
Origin = Literal["source", "skill", "memory", "llm", "human"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Segment(Contract):
    name: Text
    type: Literal["adapter", "barcode", "umi", "insert", "primer", "tso",
                  "handle", "index", "polyA", "other"]
    origin: Origin


class Strands(Contract):
    top: list[Segment]
    bottom: list[Segment]


class MoleculeState(Contract):
    id: Text
    label: Text
    strands: Strands
    origin: Origin
    evidence: list[str]
    skill_call_id: str | None
    review_status: Literal["unreviewed", "accepted", "modified", "rejected", "unresolved"]
    stale_since_revision: int | None


Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class BenchmarkScore(Contract):
    benchmark_version: Text
    metrics: dict[str, Annotated[float, Field(allow_inf_nan=False)]]


class Transition(Contract):
    id: Text
    from_id: str = Field(alias="from")
    to: str
    op: Literal["reverse_transcription", "template_switching", "pcr",
                "fragmentation", "ligation", "tagmentation", "other"]
    skill_call_id: str | None
    evidence: list[str]
    oligos: list[Text] = Field(default_factory=list)
    discarded: list[str] = Field(default_factory=list)


class Search(Contract):
    query: Text


class ListSources(Contract):
    pass


class ReadPage(Contract):
    chunk_id: Text


class SkillCall(Contract):
    skill: Literal["reverse_transcribe", "template_switch"]
    substrate_id: str
    oligo_name: Text


class CommitState(Contract):
    state: MoleculeState


class CommitTransition(Contract):
    transition: Transition


class ReviseState(Contract):
    state_id: str
    state: MoleculeState


class Assume(Contract):
    text: Text


class Finish(Contract):
    pass


ARGUMENTS = {
    "search_evidence": Search, "list_sources": ListSources, "read_page": ReadPage,
    "run_skill": SkillCall,
    "commit_state": CommitState, "commit_transition": CommitTransition,
    "revise_state": ReviseState, "assume": Assume, "finish": Finish,
}
