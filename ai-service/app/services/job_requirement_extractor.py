"""Extract structured requirements from a processed job description.

The text is split into sections by job-description headings (Step 4C's
heading matcher with the job heading vocabulary). Each bullet or sentence is
split into clauses, and every clause is classified:

1. a preferred cue ("nice to have", "a plus", "not required") -> preferred
2. a required cue ("must have", "proficiency in", "3+ years") -> required
3. otherwise its section decides: requirement/experience sections -> required,
   preferred sections -> preferred, anything else -> only mentioned.

Responsibility bullets never make a skill required. Skills use the Step 4B
dictionary, so their canonical names match those found in resumes.
"""

import re
from dataclasses import dataclass, field
from functools import lru_cache

from app.data.job_sections import (
    EMPLOYMENT_TYPE_LABELS,
    JOB_NEUTRAL_HEADINGS,
    JOB_SECTION_ALIASES,
    JOB_TITLE_LABELS,
    LOCATION_LABELS,
    PREFERRED_CUES,
    REQUIRED_CUES,
    WORK_MODE_LABELS,
)
from app.models.job_description import EducationRequirement, ExperienceRequirement, ExtractedJobRequirements, JobRequirements
from app.services.job_description_preprocessor import preprocess_job_description
from app.services.job_details_extractor import extract_job_details
from app.services.job_education_extractor import extract_clause_education
from app.services.job_experience_extractor import extract_clause_experience
from app.services.job_title_extractor import extract_job_title
from app.services.section_extractor import SectionMatcher
from app.services.skill_extractor import extract_skills_in_order
from app.utils.entry_parsing import split_clauses, split_items

INTRO = "intro"
NEUTRAL = "neutral"
_REQUIRED_SECTIONS = {"required", "experience"}
# Sections whose numbers of years are requirements even without the word "experience".
_YEARS_SECTIONS = {"required", "experience", "preferred"}
# Sections where an education mention is a requirement rather than, say, a benefit.
_EDUCATION_SOURCES = {INTRO, "required", "preferred", "experience", "education"}

# "Nice to have: Docker, Kubernetes" — a known heading used as an inline label.
_INLINE_LABEL_RE = re.compile(r"^\s*(?P<label>[^:]{2,50}?)\s*:\s*(?P<rest>\S.*)$")
# Inline labels that introduce job details, not a section of requirements.
_DETAIL_LABELS = {label.casefold() for label in JOB_TITLE_LABELS + LOCATION_LABELS + EMPLOYMENT_TYPE_LABELS + WORK_MODE_LABELS}


def _cue_regex(cues: list[str]) -> re.Pattern[str]:
    alternation = "|".join(re.escape(cue) for cue in sorted(cues, key=len, reverse=True))
    return re.compile(rf"(?<![\w-])(?:{alternation})(?![\w-])", re.IGNORECASE)


_PREFERRED_RE = _cue_regex(PREFERRED_CUES)
_REQUIRED_RE = _cue_regex(REQUIRED_CUES)


@lru_cache(maxsize=1)
def get_job_section_matcher() -> SectionMatcher:
    return SectionMatcher(JOB_SECTION_ALIASES, JOB_NEUTRAL_HEADINGS)


@dataclass
class _Block:
    section: str
    lines: list[str] = field(default_factory=list)


def _normalize_quotes(line: str) -> str:
    return line.replace("’", "'").replace("‘", "'")


def _section_for(heading: tuple[str | None, str]) -> str:
    return heading[0] or NEUTRAL


def split_sections(text: str) -> list[_Block]:
    """Group lines by the job-description section they belong to."""
    matcher = get_job_section_matcher()
    blocks = [_Block(INTRO)]
    current = INTRO
    for line in text.splitlines():
        normalized = _normalize_quotes(line)
        heading = matcher.match(normalized)
        if heading is not None:
            current = _section_for(heading)
            blocks.append(_Block(current))
            continue

        inline = _INLINE_LABEL_RE.match(normalized)
        if inline:
            label = inline.group("label").strip()
            if label.casefold() in _DETAIL_LABELS:
                # "Location: Remote" is a job detail, not part of the surrounding section.
                blocks += [_Block(NEUTRAL, [line]), _Block(current)]
                continue
            label_heading = matcher.match(label)
            if label_heading is not None:
                # The label applies to its own line only.
                blocks += [_Block(_section_for(label_heading), [inline.group("rest")]), _Block(current)]
                continue

        blocks[-1].lines.append(line)
    return [block for block in blocks if any(line.strip() for line in block.lines)]


def _classify(clause: str, section: str, states_years: bool) -> str:
    """Return "required", "preferred" or "mentioned" for the skills in a clause."""
    if section == "responsibilities":
        # Duties describe the work, not what the candidate must already know.
        return "mentioned"
    if _PREFERRED_RE.search(clause):
        return "preferred"
    if _REQUIRED_RE.search(clause):
        return "required"
    if section == "preferred":
        # "Nice to have: 5+ years of Go" stays preferred despite stating years.
        return "preferred"
    if states_years or section in _REQUIRED_SECTIONS:
        return "required"
    return "mentioned"


def _add_unique(target: list, values) -> None:
    for value in values:
        if value not in target:
            target.append(value)


def extract_job_requirements(text: str, provided_title: str | None = None) -> JobRequirements:
    """Build structured requirements from processed job-description text."""
    skills: dict[str, list[str]] = {"required": [], "preferred": [], "mentioned": []}
    experience: list[ExperienceRequirement] = []
    education: list[EducationRequirement] = []
    responsibilities: list[str] = []

    for block in split_sections(text):
        items = split_items(block.lines)
        if block.section == "responsibilities":
            _add_unique(responsibilities, items)

        for item in items:
            for clause in split_clauses(item):
                in_years_section = block.section in _YEARS_SECTIONS
                preliminary = "preferred" if _PREFERRED_RE.search(clause) or block.section == "preferred" else "required"
                years = (
                    extract_clause_experience(clause, in_requirement_section=in_years_section, preferred=preliminary == "preferred")
                    if block.section != "responsibilities"
                    else []
                )
                level = _classify(clause, block.section, states_years=bool(years))

                _add_unique(experience, years)
                if block.section in _EDUCATION_SOURCES:
                    requirement = extract_clause_education(
                        clause, in_education_section=block.section == "education", preferred=level == "preferred"
                    )
                    if requirement is not None:
                        _add_unique(education, [requirement])

                _add_unique(skills[level], extract_skills_in_order(clause))

    # Each skill appears once: required wins over preferred, which wins over mentioned.
    required = skills["required"]
    preferred = [s for s in skills["preferred"] if s not in required]
    mentioned = [s for s in skills["mentioned"] if s not in required and s not in preferred]

    location, employment_type, work_mode = extract_job_details(text)
    return JobRequirements(
        jobTitle=extract_job_title(text, provided_title),
        location=location,
        employmentType=employment_type,
        workMode=work_mode,
        requiredSkills=required,
        preferredSkills=preferred,
        mentionedSkills=mentioned,
        experienceRequirements=experience,
        educationRequirements=education,
        responsibilities=responsibilities,
    )


def extract_requirements_for_job_description(
    job_description_id: str, text: str, provided_title: str | None = None
) -> ExtractedJobRequirements:
    """Preprocess raw job-description text, then extract its requirements."""
    cleaned = preprocess_job_description(text)
    return ExtractedJobRequirements(
        jobDescriptionId=job_description_id,
        requirements=extract_job_requirements(cleaned, provided_title),
    )
