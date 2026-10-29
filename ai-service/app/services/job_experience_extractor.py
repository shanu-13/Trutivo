"""Deterministic extraction of years-of-experience requirements.

Only explicit "N years" phrasing counts: "2+ years of experience", "3-5 years",
"minimum 3 years", "at least 2 years", "2 years or more". A stated number of
years is only a requirement when the clause talks about experience, or when it
sits in a requirements/experience section; "We offer a 3-year growth plan" is
not a requirement. Areas are the canonical skills named in the same clause.
"""

import re

from app.models.job_description import ExperienceRequirement
from app.services.skill_extractor import extract_skills_in_order
from app.utils.entry_parsing import split_clauses

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
}
_NUMBER = r"(?:\d{1,2}(?:\.\d)?|" + "|".join(_NUMBER_WORDS) + r")"
_YEARS = r"(?:years?|yrs?\.?)"
_DASH = r"(?:-|–|—|to)"

# Ordered from most to least specific; the first pattern that matches a span wins.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("range", re.compile(rf"(?<![\w.])(?P<min>{_NUMBER})\s*\+?\s*{_DASH}\s*(?P<max>{_NUMBER})\s*\+?\s*{_YEARS}(?!\w)", re.I)),
    ("max", re.compile(rf"(?:\bup\s+to|\bmaximum(?:\s+of)?|\bmax\.?|\bno\s+more\s+than)\s+(?P<max>{_NUMBER})\s*{_YEARS}(?!\w)", re.I)),
    (
        "min",
        re.compile(
            rf"(?:\bminimum(?:\s+of)?|\bmin\.?|\bat\s+least|\bno\s+less\s+than|\bover|\bmore\s+than|\bupwards\s+of)\s+(?P<min>{_NUMBER})\s*\+?\s*{_YEARS}(?!\w)",
            re.I,
        ),
    ),
    ("plus", re.compile(rf"(?<![\w.])(?P<min>{_NUMBER})\s*\+\s*{_YEARS}(?!\w)|(?<![\w.])(?P<min2>{_NUMBER})\s*{_YEARS}\s*\+", re.I)),
    (
        "or_more",
        re.compile(rf"(?<![\w.])(?P<min>{_NUMBER})\s*{_YEARS}\s+(?:or\s+more|or\s+above|and\s+above|or\s+greater|minimum|min\.?)(?!\w)", re.I),
    ),
    ("exact", re.compile(rf"(?<![\w.-])(?P<min>{_NUMBER})\s*{_YEARS}(?![\w-])", re.I)),
]

# The clause must be about experience for a number of years to count outside a requirements section.
_EXPERIENCE_RE = re.compile(r"\bexperien(?:ce|ced)\b|\bexp\b", re.I)
# Numbers of years that describe something other than the candidate.
_NOT_EXPERIENCE_RE = re.compile(
    r"\b(?:years?\s+old|year\s+contract|years?\s+ago|year\s+warranty|years?\s+in\s+business|founded|anniversary"
    r"|vesting|vest|growth\s+plan|guarantee|lease|tenure\s+of\s+the\s+contract)\b",
    re.I,
)

# Years the employer has, not the candidate: "our 10 years of experience", "we have 20 years".
_COMPANY_EXPERIENCE_RE = re.compile(
    r"\b(?:our|we\s+have|we've|we\s+bring|the\s+company\s+has|has\s+been|have\s+been)\b", re.I
)


def _number(value: str) -> int | float:
    value = value.lower()
    if value in _NUMBER_WORDS:
        return _NUMBER_WORDS[value]
    number = float(value)
    return int(number) if number.is_integer() else number


def _find_matches(clause: str) -> list[tuple[re.Match[str], str]]:
    """Non-overlapping year phrases, preferring the more specific patterns."""
    taken: list[tuple[int, int]] = []
    found: list[tuple[re.Match[str], str]] = []
    for kind, pattern in _PATTERNS:
        for match in pattern.finditer(clause):
            start, end = match.span()
            if any(start < t_end and end > t_start for t_start, t_end in taken):
                continue
            taken.append((start, end))
            found.append((match, kind))
    return sorted(found, key=lambda item: item[0].start())


def extract_clause_experience(clause: str, in_requirement_section: bool, preferred: bool) -> list[ExperienceRequirement]:
    """Experience requirements stated in one clause (a bullet or sentence)."""
    if not in_requirement_section and not _EXPERIENCE_RE.search(clause):
        return []
    if _NOT_EXPERIENCE_RE.search(clause):
        return []
    if not in_requirement_section and _COMPANY_EXPERIENCE_RE.search(clause):
        return []

    matches = _find_matches(clause)
    requirements = []
    for index, (match, kind) in enumerate(matches):
        groups = match.groupdict()
        minimum = groups.get("min") or groups.get("min2")
        maximum = groups.get("max")
        # Areas: skills from this phrase up to the next one ("3+ years React, 2+ years Node").
        end = matches[index + 1][0].start() if index + 1 < len(matches) else len(clause)
        areas = extract_skills_in_order(clause[match.start() : end])
        if not areas and len(matches) == 1:
            # "React: 3+ years" names the area before the number.
            areas = extract_skills_in_order(clause)
        requirements.append(
            ExperienceRequirement(
                minimumYears=_number(minimum) if minimum else None,
                maximumYears=_number(maximum) if maximum else None,
                areas=areas,
                preferred=preferred,
                text=clause.strip(),
            )
        )
    return requirements


def has_experience_requirement(clause: str) -> bool:
    """Whether the clause states a number of years of experience."""
    return bool(extract_clause_experience(clause, in_requirement_section=False, preferred=False))


def extract_experience_requirements(text: str) -> list[ExperienceRequirement]:
    """Experience requirements anywhere in a job description.

    This standalone form treats every line as outside a requirements section,
    so each one must mention experience. The requirement extractor calls
    :func:`extract_clause_experience` with section context instead.
    """
    requirements: list[ExperienceRequirement] = []
    for clause in (c for line in text.splitlines() for c in split_clauses(line)):
        for requirement in extract_clause_experience(clause, in_requirement_section=False, preferred=False):
            if requirement not in requirements:
                requirements.append(requirement)
    return requirements
