"""Compare a resume's education with a job's education requirements.

Degrees are compared by level through the controlled table in
``app/data/degree_levels.py`` ("B.Tech" and "Bachelor's degree" are both
bachelor level). A requirement listing alternatives ("B.E./B.Tech",
"Bachelor's or Master's degree") is met by the lowest of them. When either
side's level is unknown, the result is None rather than a guess.

Fields of study are reported separately (``fieldMatch``) and do not decide
``meetsRequirement``: requirements often accept "a related field", which
cannot be judged reliably by rules.
"""

import re
from functools import lru_cache

from app.data.degree_levels import DEGREE_LEVELS, FIELD_ALIASES, LEVEL_PREFIXES, LEVEL_RANKS
from app.models.matching import (
    EducationMatch,
    EducationRequirementComparison,
    JobRequirementsInput,
    ResumeEducationInput,
    ResumeMatchInput,
)
from app.services.education_analyzer import find_degrees

_KEY_RE = re.compile(r"[\s.'’]")
_WORDS_RE = re.compile(r"[a-z0-9]+")


def _key(text: str) -> str:
    return _KEY_RE.sub("", text).casefold()


@lru_cache(maxsize=1)
def _levels_by_key() -> dict[str, str]:
    levels: dict[str, str] = {}
    for level, names in DEGREE_LEVELS.items():
        for name in names:
            levels[_key(name)] = level
    return levels


def degree_level(degree: str | None) -> str | None:
    """The level of one degree name, or None when it is not in the controlled table."""
    if not degree:
        return None
    key = _key(degree)
    level = _levels_by_key().get(key) or _levels_by_key().get(key.removesuffix("degree"))
    if level:
        return level
    lowered = degree.casefold().strip()
    for prefix, prefix_level in LEVEL_PREFIXES.items():
        if lowered.startswith(prefix):
            return prefix_level
    return None


def _requirement_level(degree: str | None) -> str | None:
    """The lowest level among the alternatives a requirement names."""
    if not degree:
        return None
    mentions = [m.group(0) for m in find_degrees(degree)] or [degree]
    levels = [degree_level(mention) for mention in mentions]
    known = [level for level in levels if level]
    # If any alternative is unknown, the lowest acceptable level is unknown too.
    if not known or len(known) != len(levels):
        return None
    return min(known, key=LEVEL_RANKS.__getitem__)


@lru_cache(maxsize=1)
def _field_aliases() -> dict[str, str]:
    aliases: dict[str, str] = {}
    for canonical, names in FIELD_ALIASES.items():
        aliases[canonical.casefold()] = canonical.casefold()
        for name in names:
            aliases[name.casefold()] = canonical.casefold()
    return aliases


def _canonical_field(field: str) -> str:
    text = " ".join(field.casefold().replace("&", " and ").split())
    return _field_aliases().get(text, text)


def _contains_words(haystack: str, needle: str) -> bool:
    words, target = _WORDS_RE.findall(haystack), _WORDS_RE.findall(needle)
    return bool(target) and any(words[i : i + len(target)] == target for i in range(len(words) - len(target) + 1))


def field_matches(candidate: str | None, required: list[str]) -> bool | None:
    if not required or not candidate:
        return None
    mine = _canonical_field(candidate)
    for field in required:
        theirs = _canonical_field(field)
        if mine == theirs or _contains_words(mine, theirs) or _contains_words(theirs, mine):
            return True
    return False


def _describe(entry: ResumeEducationInput) -> str | None:
    text = " ".join(part for part in (entry.degree, entry.field) if part)
    return text or None


def _best_entry(entries: list[ResumeEducationInput], required_fields: list[str]) -> ResumeEducationInput | None:
    """The highest-level entry, preferring one in a required field."""
    leveled = [(entry, degree_level(entry.degree)) for entry in entries if entry.degree]
    known = [(entry, level) for entry, level in leveled if level]
    if not known:
        return leveled[0][0] if leveled else None
    return max(
        known,
        key=lambda item: (LEVEL_RANKS[item[1]], field_matches(item[0].field, required_fields) is True),
    )[0]


def compare_education(resume: ResumeMatchInput, job_requirements: JobRequirementsInput) -> EducationMatch:
    requirements = job_requirements.educationRequirements
    if not requirements:
        return EducationMatch(status="not_applicable")

    comparisons = []
    for requirement in requirements:
        required_level = _requirement_level(requirement.degree)
        best = _best_entry(resume.education, requirement.fields)
        candidate_level = degree_level(best.degree) if best else None

        met = None
        if required_level and candidate_level:
            met = LEVEL_RANKS[candidate_level] >= LEVEL_RANKS[required_level]

        comparisons.append(
            EducationRequirementComparison(
                requirement=requirement.degree,
                requiredFields=requirement.fields,
                preferred=requirement.preferred,
                text=requirement.text,
                requiredLevel=required_level,
                candidateEducation=_describe(best) if best else None,
                candidateLevel=candidate_level,
                meetsRequirement=met,
                fieldMatch=field_matches(best.field if best else None, requirement.fields),
            )
        )
    return EducationMatch(status="compared", requirements=comparisons)
