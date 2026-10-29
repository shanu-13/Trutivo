"""Request and response models for rule-based cover letter generation (Step 12).

The request carries only structured facts taken from the candidate's own
resume analysis and the job's extracted requirements: no raw resume or job
text, and no contact details other than the candidate's name.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
LineText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]

Tone = Literal["professional", "confident", "conversational", "concise"]
Length = Literal["short", "standard", "detailed"]


class _Input(BaseModel):
    # Fields outside the contract are dropped, never trusted.
    model_config = ConfigDict(extra="ignore")


class ExperienceFact(_Input):
    title: ShortText | None = None
    company: ShortText | None = None
    startDate: ShortText | None = None
    endDate: ShortText | None = None
    isCurrent: bool = False
    highlights: list[LineText] = Field(default_factory=list, max_length=12)


class ProjectFact(_Input):
    name: ShortText | None = None
    technologies: list[ShortText] = Field(default_factory=list, max_length=30)
    highlights: list[LineText] = Field(default_factory=list, max_length=12)


class EducationFact(_Input):
    degree: ShortText | None = None
    field: ShortText | None = None
    institution: ShortText | None = None
    isCurrent: bool = False


class CandidateFacts(_Input):
    name: ShortText | None = None
    skills: list[ShortText] = Field(default_factory=list, max_length=300)
    experience: list[ExperienceFact] = Field(default_factory=list, max_length=30)
    projects: list[ProjectFact] = Field(default_factory=list, max_length=30)
    education: list[EducationFact] = Field(default_factory=list, max_length=15)
    certifications: list[ShortText] = Field(default_factory=list, max_length=30)


class JobFacts(_Input):
    title: ShortText = Field(min_length=1)
    companyName: ShortText | None = None
    requiredSkills: list[ShortText] = Field(default_factory=list, max_length=300)
    preferredSkills: list[ShortText] = Field(default_factory=list, max_length=300)


class CoverLetterRequest(_Input):
    candidate: CandidateFacts
    job: JobFacts
    tone: Tone = "professional"
    length: Length = "standard"


class UsedFacts(BaseModel):
    skills: list[str] = Field(default_factory=list)
    experience: list[str] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)


class CoverLetter(BaseModel):
    method: Literal["rule_based"] = "rule_based"
    tone: Tone
    length: Length
    paragraphs: list[str]
    text: str
    wordCount: int
    # Bracketed parts the candidate must fill in themselves.
    placeholders: list[str] = Field(default_factory=list)
    usedFacts: UsedFacts
    # Things the letter deliberately does not claim (e.g. job skills missing from the resume).
    notes: list[str] = Field(default_factory=list)
