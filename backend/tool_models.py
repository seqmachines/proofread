"""Proofread request arguments and saved benchmark scores."""

from typing import Annotated, Literal

from pydantic import Field
from cdna.molecule import Contract, MoleculeState, Text, Transition
from cdna.tools import ARGUMENTS as SKILL_ARGUMENTS


Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class BenchmarkScore(Contract):
    benchmark_version: Text
    metrics: dict[str, Annotated[float, Field(allow_inf_nan=False)]]


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
    **SKILL_ARGUMENTS,
    "search_evidence": Search, "list_sources": ListSources, "read_page": ReadPage,
    "run_skill": SkillCall,
    "commit_state": CommitState, "commit_transition": CommitTransition,
    "revise_state": ReviseState, "assume": Assume, "finish": Finish,
}
