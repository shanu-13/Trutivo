from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.utils.validation import validate_text_input

EMPTY_RESUME_TEXT = "empty_resume_text"
RESUME_TEXT_TOO_LARGE = "resume_text_too_large"


class ResumeTextRequest(BaseModel):
    """Resume text sent by the Node backend, validated for size and emptiness."""

    resume_id: str = Field(min_length=1, max_length=64)
    text: str

    @field_validator("resume_id", mode="before")
    @classmethod
    def strip_resume_id(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("text", mode="before")
    @classmethod
    def validate_text(cls, value: Any) -> Any:
        return validate_text_input(
            value,
            max_length=get_settings().max_resume_text_length,
            too_large_type=RESUME_TEXT_TOO_LARGE,
            too_large_message="Resume text is too large",
            empty_type=EMPTY_RESUME_TEXT,
            empty_message="Resume text cannot be empty",
        )


class PreprocessedResume(BaseModel):
    resumeId: str
    text: str


class ResumePreprocessRequest(ResumeTextRequest):
    pass


class SkillExtractionRequest(ResumeTextRequest):
    pass


class ExtractedSkills(BaseModel):
    resumeId: str
    # Category key -> canonical skill names. Empty categories are omitted.
    skills: dict[str, list[str]]
    totalSkills: int


class SectionExtractionRequest(ResumeTextRequest):
    pass


class ResumeSections(BaseModel):
    """Resume text split by section. Sections that were not found are None."""

    personal_information: str | None = None
    summary: str | None = None
    experience: str | None = None
    education: str | None = None
    projects: str | None = None
    skills: str | None = None
    certifications: str | None = None
    achievements: str | None = None
    languages: str | None = None
    interests: str | None = None
    references: str | None = None
    # Recognised headings without a canonical section, keyed by the heading as written.
    other_sections: dict[str, str] = Field(default_factory=dict)


class ExtractedSections(BaseModel):
    resumeId: str
    sections: ResumeSections


class ResumeAnalysisRequest(ResumeTextRequest):
    pass


# Structured analysis. Every text value is copied from the resume as written;
# a field is None when it could not be identified reliably.


class PersonalInformation(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin: str | None = None
    github: str | None = None
    portfolio: str | None = None


class ExperienceEntry(BaseModel):
    title: str | None = None
    company: str | None = None
    location: str | None = None
    startDate: str | None = None
    # None both for ongoing roles (see isCurrent) and when no end date is given.
    endDate: str | None = None
    isCurrent: bool = False
    description: list[str] = Field(default_factory=list)
    # The entry exactly as it appeared, so nothing is lost when parsing is ambiguous.
    rawText: str


class EducationEntry(BaseModel):
    degree: str | None = None
    field: str | None = None
    institution: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    isCurrent: bool = False
    grade: str | None = None
    rawText: str


class ProjectEntry(BaseModel):
    name: str | None = None
    description: list[str] = Field(default_factory=list)
    # Canonical skill names from the Step 4B skill dictionary.
    technologies: list[str] = Field(default_factory=list)
    url: str | None = None
    rawText: str


class CertificationEntry(BaseModel):
    name: str
    issuer: str | None = None
    date: str | None = None


class StructuredResume(BaseModel):
    personalInformation: PersonalInformation
    summary: str | None = None
    experience: list[ExperienceEntry] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)
    # Category key -> canonical skill names, as returned by skill extraction.
    skills: dict[str, list[str]] = Field(default_factory=dict)
    certifications: list[CertificationEntry] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    otherSections: dict[str, str] = Field(default_factory=dict)


class ResumeMetadata(BaseModel):
    totalSkills: int
    totalExperienceEntries: int
    totalEducationEntries: int
    totalProjects: int
    totalCertifications: int


class ResumeAnalysis(BaseModel):
    resumeId: str
    resume: StructuredResume
    metadata: ResumeMetadata
