"""Compare a resume's experience with a job's years-of-experience requirements.

Total experience is the union of the months covered by the resume's jobs, so
overlapping jobs are not counted twice. It is only calculated when every job
has a month-precise start and an end (a month-precise date, "Present" or
"Current"). A year-only date such as "2019 - 2021" could mean anything from a
few months to three years, so it makes the total unknown rather than guessed.

Skill-specific experience ("3+ years of React") is never inferred from the
skill appearing somewhere in the resume. The evidence is limited to dated jobs
whose own text names the skill, and it is only used as a lower bound.
"""

import re
from datetime import date

from app.models.matching import (
    ExperienceAreaComparison,
    ExperienceMatch,
    ExperienceRequirementComparison,
    JobRequirementsInput,
    ResumeExperienceInput,
    ResumeMatchInput,
)
from app.services.skill_extractor import canonical_skill, extract_skills_in_order

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_NAME_RE = re.compile(r"^(?P<month>[a-z]{3})[a-z]*\.?,?\s*(?P<year>\d{4}|'\d{2})$", re.IGNORECASE)
_NUMERIC_RE = re.compile(r"^(?P<month>\d{1,2})\s*[/.-]\s*(?P<year>\d{4})$")
_YEAR_ONLY_RE = re.compile(r"^\d{4}$")

Interval = tuple[int, int]  # inclusive month indexes (year * 12 + month - 1)


class _Imprecise(Exception):
    """A date that is missing or not precise to the month."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _month_index(value: str | None) -> int:
    if not value or not value.strip():
        raise _Imprecise("Some jobs have no start or end date")
    text = value.strip()
    if _YEAR_ONLY_RE.match(text):
        raise _Imprecise("Some job dates give only a year, not a month")

    match = _MONTH_NAME_RE.match(text)
    if match and match.group("month").lower() in _MONTHS:
        year_text = match.group("year")
        year = 2000 + int(year_text[1:]) if year_text.startswith("'") else int(year_text)
        return year * 12 + _MONTHS[match.group("month").lower()] - 1

    match = _NUMERIC_RE.match(text)
    if match and 1 <= int(match.group("month")) <= 12:
        return int(match.group("year")) * 12 + int(match.group("month")) - 1

    raise _Imprecise("Some job dates are in a format that cannot be read")


def _interval(entry: ResumeExperienceInput, today: int) -> Interval:
    start = _month_index(entry.startDate)
    if entry.isCurrent:
        end = today
    elif entry.endDate:
        end = _month_index(entry.endDate)
    else:
        raise _Imprecise("Some jobs have no end date")
    if start > end or start > today:
        raise _Imprecise("Some job dates are out of order or in the future")
    return start, min(end, today)


def date_issue(entry: ResumeExperienceInput, today: date) -> str | None:
    """Why this job's dates cannot be used for an experience total, or None if they can."""
    try:
        _interval(entry, today.year * 12 + today.month - 1)
    except _Imprecise as imprecise:
        return imprecise.reason
    return None


def _union_months(intervals: list[Interval]) -> int:
    """Months covered by at least one interval (both ends inclusive)."""
    total = 0
    current: Interval | None = None
    for start, end in sorted(intervals):
        if current is None or start > current[1] + 1:
            if current is not None:
                total += current[1] - current[0] + 1
            current = (start, end)
        else:
            current = (current[0], max(current[1], end))
    if current is not None:
        total += current[1] - current[0] + 1
    return total


def _years(months: int) -> float:
    years = round(months / 12, 1)
    return int(years) if years.is_integer() else years


def calculate_total_years(entries: list[ResumeExperienceInput], today: date) -> tuple[float | None, str | None]:
    """Return (years, None), or (None, reason) when the dates do not allow a reliable total."""
    if not entries:
        return None, "The resume lists no work experience"
    today_index = today.year * 12 + today.month - 1
    try:
        intervals = [_interval(entry, today_index) for entry in entries]
    except _Imprecise as imprecise:
        return None, imprecise.reason
    return _years(_union_months(intervals)), None


def _area_years(area: str, entries: list[ResumeExperienceInput], today: date) -> float | None:
    """Years of dated jobs whose text names ``area``; None if none can be dated."""
    today_index = today.year * 12 + today.month - 1
    intervals = []
    for entry in entries:
        if area not in extract_skills_in_order(entry.text):
            continue
        try:
            intervals.append(_interval(entry, today_index))
        except _Imprecise:
            continue
    return _years(_union_months(intervals)) if intervals else None


def _meets(candidate: float | None, minimum: float | None) -> bool | None:
    if candidate is None or minimum is None:
        return None
    return candidate >= minimum


def compare_experience(
    resume: ResumeMatchInput,
    job_requirements: JobRequirementsInput,
    resume_skills: set[str],
    today: date | None = None,
) -> ExperienceMatch:
    requirements = job_requirements.experienceRequirements
    if not requirements:
        return ExperienceMatch(status="not_applicable")

    today = today or date.today()
    total, reason = calculate_total_years(resume.experience, today)

    comparisons = []
    for requirement in requirements:
        areas = []
        for raw_area in requirement.areas:
            area = canonical_skill(raw_area) or raw_area
            if area not in resume_skills:
                # Not in the resume at all: no evidence of the skill, let alone the years.
                areas.append(ExperienceAreaComparison(area=area, requiredYears=requirement.minimumYears, meetsRequirement=False))
                continue
            evidence = _area_years(area, resume.experience, today)
            met = _meets(evidence, requirement.minimumYears)
            areas.append(
                ExperienceAreaComparison(
                    area=area,
                    requiredYears=requirement.minimumYears,
                    candidateYears=evidence,
                    # Evidence is a lower bound: falling short of it proves nothing.
                    meetsRequirement=True if met else None,
                )
            )

        if areas:
            outcomes = [a.meetsRequirement for a in areas]
            met = False if False in outcomes else (True if all(o is True for o in outcomes) else None)
            candidate = None
        else:
            met = _meets(total, requirement.minimumYears)
            candidate = total

        comparisons.append(
            ExperienceRequirementComparison(
                minimumYears=requirement.minimumYears,
                maximumYears=requirement.maximumYears,
                preferred=requirement.preferred,
                text=requirement.text,
                candidateYears=candidate,
                meetsRequirement=met,
                areas=areas,
            )
        )

    general = [r.minimumYears for r in requirements if not r.preferred and not r.areas and r.minimumYears is not None]
    required_years = max(general) if general else None
    return ExperienceMatch(
        status="compared",
        requiredYears=required_years,
        candidateYears=total,
        candidateYearsReason=reason,
        meetsRequirement=_meets(total, required_years),
        requirements=comparisons,
    )
