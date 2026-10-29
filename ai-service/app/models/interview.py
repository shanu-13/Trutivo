"""Request and response models for rule-based mock interviews (Step 16).

Question generation takes the same structured facts as cover letters: the
candidate's own resume analysis and the job's extracted requirements, never raw
text. Evaluation takes one stored question and the candidate's answer.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.cover_letter import CandidateFacts, JobFacts

InterviewType = Literal["technical", "behavioral", "hr", "mixed"]
QuestionType = Literal["technical", "behavioral", "hr"]
Difficulty = Literal["beginner", "intermediate", "advanced"]

# Hard limits on this service's side; the backend applies its own (lower) configured limit.
MAX_QUESTIONS = 15
MAX_ANSWER_CHARS = 10_000

Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Keyword = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class _Input(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ExpectedPoint(_Input):
    label: Label
    keywords: list[Keyword] = Field(min_length=1, max_length=20)


class Grounding(_Input):
    # Where the question comes from: a skill in both resume and job, only the job, only the resume, or general.
    source: Literal["resume_and_job", "job", "resume", "general"]
    skill: Label | None = None
    # The candidate's own role or project the question refers to, if any.
    resumeReference: Label | None = None


class Question(_Input):
    type: QuestionType
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=1000)]
    focus: Label
    difficulty: Difficulty
    expectedPoints: list[ExpectedPoint] = Field(min_length=1, max_length=8)
    grounding: Grounding
    guidance: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


class QuestionRequest(_Input):
    candidate: CandidateFacts
    job: JobFacts
    interviewType: InterviewType
    difficulty: Difficulty
    count: int = Field(ge=1, le=MAX_QUESTIONS)


class QuestionSet(BaseModel):
    method: Literal["rule_based"] = "rule_based"
    generatorVersion: str
    questions: list[Question]
    # Honest notes about the set, e.g. job skills the resume does not list.
    notes: list[str] = Field(default_factory=list)


class EvaluationRequest(_Input):
    question: Question
    answer: Annotated[str, StringConstraints(max_length=MAX_ANSWER_CHARS)]
    roleSkills: list[Label] = Field(default_factory=list, max_length=300)


class Evaluation(BaseModel):
    method: Literal["rule_based"] = "rule_based"
    rulesVersion: str
    score: int = Field(ge=0, le=100)
    # True when the answer is too short or general to judge; the score is then capped.
    insufficientDetail: bool
    strengths: list[str]
    missingPoints: list[str]
    suggestions: list[str]
    exampleAnswer: str | None
    conceptsToReview: list[str]
    # Points of the question covered by the answer (for transparency).
    coveredPoints: list[str]
    wordCount: int
