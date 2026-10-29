from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.utils.validation import validate_text_input

EMPTY_JOB_DESCRIPTION_TEXT = "empty_job_description_text"
JOB_DESCRIPTION_TEXT_TOO_LARGE = "job_description_text_too_large"


class JobDescriptionTextRequest(BaseModel):
    """Job description text sent by the Node backend, validated for size and emptiness."""

    job_description_id: str = Field(min_length=1, max_length=64)
    text: str

    @field_validator("job_description_id", mode="before")
    @classmethod
    def strip_job_description_id(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("text", mode="before")
    @classmethod
    def validate_text(cls, value: Any) -> Any:
        return validate_text_input(
            value,
            max_length=get_settings().max_job_description_text_length,
            too_large_type=JOB_DESCRIPTION_TEXT_TOO_LARGE,
            too_large_message="Job description text is too large",
            empty_type=EMPTY_JOB_DESCRIPTION_TEXT,
            empty_message="Job description text cannot be empty",
        )


class JobDescriptionProcessRequest(JobDescriptionTextRequest):
    pass


class ProcessedJobDescription(BaseModel):
    jobDescriptionId: str
    processedText: str


class JobRequirementsRequest(JobDescriptionTextRequest):
    # The title the user stored for this job description. When given, it is
    # returned as-is instead of a title extracted from the text.
    job_title: str | None = Field(default=None, max_length=200)

    @field_validator("job_title", mode="before")
    @classmethod
    def strip_job_title(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip() or None
        return value


# Every value is taken from the job description text as written; a field is
# None or empty when the text does not state it explicitly.


class ExperienceRequirement(BaseModel):
    minimumYears: int | float | None = None
    maximumYears: int | float | None = None
    # Canonical skill names named alongside the years ("3+ years of React").
    areas: list[str] = Field(default_factory=list)
    # True when the text marks it as optional ("5+ years preferred").
    preferred: bool = False
    # The sentence or bullet the requirement was read from.
    text: str


class EducationRequirement(BaseModel):
    # The degree as written ("Bachelor's degree", "B.E./B.Tech"); None for "Degree in ...".
    degree: str | None = None
    fields: list[str] = Field(default_factory=list)
    preferred: bool = False
    text: str


class JobRequirements(BaseModel):
    jobTitle: str | None = None
    location: str | None = None
    employmentType: str | None = None
    workMode: str | None = None
    # Canonical skill names from the Step 4B skill dictionary. A skill appears in
    # exactly one list: required wins over preferred, which wins over mentioned.
    requiredSkills: list[str] = Field(default_factory=list)
    preferredSkills: list[str] = Field(default_factory=list)
    # Skills named without any requirement context ("Our stack: Go, Kafka").
    mentionedSkills: list[str] = Field(default_factory=list)
    experienceRequirements: list[ExperienceRequirement] = Field(default_factory=list)
    educationRequirements: list[EducationRequirement] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)


class ExtractedJobRequirements(BaseModel):
    jobDescriptionId: str
    requirements: JobRequirements
