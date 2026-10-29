"""Deterministic extraction of education requirements from a job description.

Degrees come from the same vocabulary used for resumes (Step 4D), so "B.Tech",
"Bachelor's degree" or "MBA" are recognised the same way on both sides. Fields
of study are the words after "in"/"of" ("Bachelor's degree in Computer
Science or a related field" -> ["Computer Science"]). Nothing is assumed: a
clause without an explicit degree or "degree in ..." yields no requirement.
"""

import re

from app.models.job_description import EducationRequirement
from app.services.education_analyzer import find_degrees
from app.utils.entry_parsing import split_clauses

# Degree mentions that are also ordinary words or other abbreviations need
# education context nearby ("MS Office", "intermediate SQL", "BA" as in Business Analyst).
_WEAK_DEGREES = {"bs", "ms", "ba", "be", "masters", "bachelors", "intermediate", "12th", "10th", "high school", "ged"}
_EDUCATION_CONTEXT_RE = re.compile(
    r"\b(?:degree|degrees|graduate|graduates|graduation|graduated|qualification|qualifications|qualified"
    r"|education|educational|university|college|diploma|bachelor'?s?|master'?s?|ph\.?d|doctorate)\b",
    re.IGNORECASE,
)
_NOT_A_DEGREE_AFTER_RE = re.compile(
    r"^\s*(?:office|excel|word|teams|outlook|powerpoint|access|project|visio|sql|dynamics|azure|exchange|365)\b",
    re.IGNORECASE,
)
# Text between two alternative degrees: "B.E./B.Tech", "Bachelor's or Master's".
_DEGREE_JOINER_RE = re.compile(r"^\s*(?:/|,|\||&|or|and|and/or)\s*(?:an?\s+)?$", re.IGNORECASE)
_TRAILING_DEGREE_WORD_RE = re.compile(r"^\s+degrees?\b", re.IGNORECASE)
_GENERIC_DEGREE_RE = re.compile(r"\b(?:degree|graduate|graduation)\s+(?=(?:in|of)\s)", re.IGNORECASE)

_FIELDS_START_RE = re.compile(r"^\.?\s*(?:\([^)]*\)\s*)?(?:degree\s+)?(?:in|of)\s+", re.IGNORECASE)
# "BS/MS in Computer Science": a degree followed by a field is a degree even without other context.
_FOLLOWED_BY_FIELD_RE = re.compile(r"^\s*(?:(?:/|or|and)\s*[A-Za-z.']+\s*)*(?:degree\s+)?in\s+[A-Z]", re.IGNORECASE)
# Where the list of fields ends.
_FIELDS_END_RE = re.compile(
    r"[.;:()]|\s+(?:with|from|at|is|are|preferred|required|or\s+equivalent|and\s+\d|plus)\b|\s+\d",
    re.IGNORECASE,
)
_FIELD_SPLIT_RE = re.compile(r"\s*(?:,|/|&|\bor\b|\band\b)\s*", re.IGNORECASE)
# Fields that only say "something similar".
_VAGUE_FIELD_RE = re.compile(r"\b(?:related|equivalent|similar|relevant|other|any|etc)\b", re.IGNORECASE)
_ARTICLE_RE = re.compile(r"^(?:an?|the)\s+", re.IGNORECASE)
_GENERIC_FIELD_WORD_RE = re.compile(r"\s+(?:field|fields|discipline|disciplines|subject|subjects)$", re.IGNORECASE)
_MAX_FIELD_WORDS = 5


def _fields(text: str) -> list[str]:
    start = _FIELDS_START_RE.match(text)
    if not start:
        return []
    rest = text[start.end() :]
    end = _FIELDS_END_RE.search(rest)
    rest = rest[: end.start()] if end else rest

    fields: list[str] = []
    for part in _FIELD_SPLIT_RE.split(rest):
        field = _GENERIC_FIELD_WORD_RE.sub("", _ARTICLE_RE.sub("", part.strip(" ,"))).strip()
        if not field or _VAGUE_FIELD_RE.search(field) or len(field.split()) > _MAX_FIELD_WORDS:
            continue
        if any(ch.isdigit() for ch in field) or field.lower() in {"field", "fields", "degree"}:
            continue
        if field not in fields:
            fields.append(field)
    return fields


def _degree_matches(clause: str, has_context: bool) -> list[re.Match[str]]:
    matches = []
    for match in find_degrees(clause):
        if _NOT_A_DEGREE_AFTER_RE.match(clause[match.end() :]):
            continue
        # Only the undotted forms are ambiguous: "B.E." is a degree, "BE" may not be.
        weak = match.group(0).casefold() in _WEAK_DEGREES
        if weak and not has_context and not _FOLLOWED_BY_FIELD_RE.match(clause[match.end() :]):
            continue
        matches.append(match)
    return matches


def extract_clause_education(clause: str, in_education_section: bool, preferred: bool) -> EducationRequirement | None:
    """The education requirement stated in one clause, if any."""
    has_context = in_education_section or bool(_EDUCATION_CONTEXT_RE.search(clause))
    degrees = _degree_matches(clause, has_context)

    if degrees:
        # Alternatives written together form one requirement: "B.E./B.Tech", "Bachelor's or Master's degree".
        first, last = degrees[0], degrees[0]
        for match in degrees[1:]:
            if not _DEGREE_JOINER_RE.match(clause[last.end() : match.start()]):
                break
            last = match
        end = last.end()
        trailing = _TRAILING_DEGREE_WORD_RE.match(clause[end:])
        if trailing and "degree" not in clause[first.start() : end].lower():
            end += trailing.end()
        return EducationRequirement(
            degree=clause[first.start() : end].strip(),
            fields=_fields(clause[end:]),
            preferred=preferred,
            text=clause.strip(),
        )

    generic = _GENERIC_DEGREE_RE.search(clause)
    if generic:
        fields = _fields(clause[generic.end() :])
        if fields:
            return EducationRequirement(degree=None, fields=fields, preferred=preferred, text=clause.strip())
    return None


def extract_education_requirements(text: str) -> list[EducationRequirement]:
    """Education requirements anywhere in a job description, without section context."""
    requirements: list[EducationRequirement] = []
    for clause in (c for line in text.splitlines() for c in split_clauses(line)):
        requirement = extract_clause_education(clause, in_education_section=False, preferred=False)
        if requirement and requirement not in requirements:
            requirements.append(requirement)
    return requirements
