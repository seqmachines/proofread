"""M6 output validation against §2.3/2.4; also used at signal write time."""

from typing import Literal

from pydantic import Field, model_validator

from molecules import Contract, Text

ErrorType = Literal["missing_recoverable_information", "unsupported_completion",
                    "operation_error", "strand_or_orientation_error",
                    "molecular_state_or_assembly_error", "workflow_or_topology_error"]
Operation = Literal["reverse_transcription", "template_switching", "pcr",
                    "fragmentation", "ligation", "tagmentation", "other"]
PatchValue = str | int | bool | list[str] | None


class HarnessPatch(Contract):
    type: Literal["tool_access", "context_policy", "guardrail", "rule"]
    path: Text
    from_value: PatchValue = Field(alias="from")
    to: PatchValue
    reason: Text
    scope: Operation | None = None

    @model_validator(mode="after")
    def allowed_patch(self):
        if self.from_value == self.to:
            raise ValueError("Patch must change a harness setting")
        if self.type == "tool_access":
            if self.path not in {"tool_access.reverse_transcribe", "tool_access.template_switch"}:
                raise ValueError("Unknown skill patch path")
            if self.from_value not in ("off", "available", "mandatory") or self.to not in ("off", "available", "mandatory"):
                raise ValueError("Invalid tool access value")
        elif self.type in {"guardrail", "rule"}:
            if self.path != {"guardrail": "guardrails", "rule": "rules"}[self.type]:
                raise ValueError("Invalid harness list patch path")
            if not isinstance(self.from_value, list) or not isinstance(self.to, list):
                raise ValueError("Harness list patches need list-valued from/to")
            if self.type == "guardrail" and (
                not set(self.from_value) < set(self.to)
                or not set(self.to) <= {"evidence_required", "provenance_required", "bottom_strand_3to5"}
                or len(self.to) != len(set(self.to))
            ):
                raise ValueError("A guardrail proposal must add a supported guardrail")
            if self.type == "rule" and self.scope is None:
                raise ValueError("Rule patches need an operation scope; workflow-wide rules are forbidden")
        elif self.type == "context_policy":
            if self.path == "context_policy.evidence_k":
                if type(self.to) is not int or not 1 <= self.to <= 20:
                    raise ValueError("evidence_k must be an integer from 1 to 20")
            elif self.path == "context_policy.include_linked_oligos":
                if type(self.to) is not bool:
                    raise ValueError("include_linked_oligos must be boolean")
            else:
                raise ValueError("Unsupported context patch; CLI history cannot be patched")
        return self

    def document(self):
        return self.model_dump(by_alias=True, exclude={"scope"} if self.scope is None else set())


class Diagnosis(Contract):
    error_type: ErrorType
    operation: Operation
    state_id: str | None
    evidence: list[str]
    root_cause: Text
    recommended_action: Text
    harness_relevance: Literal["high", "low"]
    proposed_patch: HarnessPatch | None


class Finding(Diagnosis):
    finding: Text


class Review(Contract):
    findings: list[Finding] = Field(max_length=6)


class Signal(Diagnosis):
    id: str = Field(alias="_id")
    run_id: str
    protocol_id: str
    harness_version: str
    source: Literal["verifier", "reviewer", "human"]
    signature: str
    systematic: bool
    processed: bool
    created_at: str
    review_id: str | None = None

    @model_validator(mode="after")
    def signature_matches(self):
        if self.signature != f"{self.error_type}×{self.operation}":
            raise ValueError("Signal signature must be error_type×operation")
        return self


class ReviewRequest(Contract):
    run_id: str
    workflow_revision: int = Field(ge=1)
    target_id: Text
    decision: Literal["accept", "modify", "reject", "unresolved"]
    before: dict
    after: dict | None = None
    note: str = Field(default="", max_length=10000)
    error_type: ErrorType | None = None
    systematic: bool = False

    @model_validator(mode="after")
    def decision_fields(self):
        if (self.decision == "modify") != (self.after is not None):
            raise ValueError("Only modify requires an after value; other decisions use null")
        if (self.decision in {"modify", "reject"}) != (self.error_type is not None):
            raise ValueError("Modify/reject require a confirmed error_type; other decisions use null")
        return self
