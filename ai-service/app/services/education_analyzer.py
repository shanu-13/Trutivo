"""Split an education section into individual qualifications.

Entries are anchored on their date lines, or on degree lines when the section
has no dates. Within an entry the degree comes from the degree vocabulary (or
a "Bachelor of ..."/"Master of ..." phrase), the field is the text that follows
the degree, the institution is the part naming a university/college/school,
and the grade is a CGPA/GPA/percentage pattern. Anything not identified stays
None and the original text is kept in ``rawText``.
"""

import re
from functools import lru_cache

from app.data.resume_entities import DEGREE_ABBREVIATIONS, DEGREE_PHRASES, INSTITUTION_KEYWORDS
from app.models.resume import EducationEntry
from app.utils.dates import find_date_range, has_date, remove_span
from app.utils.entry_parsing import (
    Entry,
    collapse,
    contains_keyword,
    is_header_like,
    segment_entries,
    split_parts,
)

_GRADE_RE = re.compile(
    r"(?:c?gpa|cpi|sgpa|percentage|aggregate|score|marks)[ \t]*[:\-–]?[ \t]*\d{1,3}(?:\.\d{1,2})?(?:[ \t]*/[ \t]*\d{1,3}(?:\.\d{1,2})?)?[ \t]*%?"
    r"|\d{1,2}(?:\.\d{1,2})?(?:[ \t]*/[ \t]*\d{1,2}(?:\.\d{1,2})?)?[ \t]*(?:c?gpa|cpi|sgpa)\b"
    r"|(?<![\d.])\d{2,3}(?:\.\d{1,2})?[ \t]*%"
    r"|grade[ \t]*[:\-–][ \t]*[A-F][+-]?(?![\w])"
    r"|first[ \t]+class(?:[ \t]+with[ \t]+distinction)?|(?:summa|magna)?[ \t]*cum[ \t]+laude",
    re.IGNORECASE,
)
# Generic degree phrases not in the vocabulary: "Bachelor of Computer Science".
_GENERIC_DEGREE_RE = re.compile(r"\b(?:Bachelor|Master|Doctor)(?:'s|s)?\s+of\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}")
# Where the field of study ends: "Computer Science, XYZ University" / "Physics | 2020".
_FIELD_END_RE = re.compile(r"\s*(?:[,|;(]|\s[–—-]\s|[–—]|\s(?:from|at)\s|\d)", re.IGNORECASE)
_HONOURS_RE = re.compile(r"^\(\s*hon(?:ou?)?rs?\.?\s*\)", re.IGNORECASE)
_CLASS_LEVEL_RE = re.compile(r"^\s*(?:[IVX]+|\d{1,2}(?:st|nd|rd|th)?|class\s+\w+|std\.?\s*\w+)\s*$", re.IGNORECASE)
_MAX_FIELD_LENGTH = 60
_MAX_INSTITUTION_WORDS = 10


def _abbreviation_pattern(abbreviation: str) -> str:
    letters = abbreviation.replace(".", "")
    if len(letters) <= 2 and "." in abbreviation:
        # Short dotted forms keep their dots: "M.A." but not "MA".
        return r"\.\s?".join(map(re.escape, letters)) + r"\.?"
    body = "".join(r"\.?\s?" if ch == "." else re.escape(ch) for ch in abbreviation.rstrip("."))
    return body + (r"\.?" if abbreviation.endswith(".") else "")


@lru_cache(maxsize=1)
def _degree_regexes() -> tuple[re.Pattern[str], re.Pattern[str]]:
    abbreviations = sorted(DEGREE_ABBREVIATIONS, key=len, reverse=True)
    phrases = sorted(DEGREE_PHRASES, key=len, reverse=True)
    abbreviation_re = re.compile(
        r"(?<![A-Za-z])(?:" + "|".join(_abbreviation_pattern(a) for a in abbreviations) + r")(?![A-Za-z])"
    )
    phrase_re = re.compile(
        r"(?<![A-Za-z])(?:" + "|".join(r"\s+".join(map(re.escape, p.split())) for p in phrases) + r")(?![A-Za-z])",
        re.IGNORECASE,
    )
    return abbreviation_re, phrase_re


def find_degree(text: str) -> re.Match[str] | None:
    """Return the earliest (then longest) degree mention in ``text``."""
    matches = [m for regex in (*_degree_regexes(), _GENERIC_DEGREE_RE) if (m := regex.search(text))]
    if not matches:
        return None
    return min(matches, key=lambda m: (m.start(), -len(m.group(0))))


def find_degrees(text: str) -> list[re.Match[str]]:
    """All non-overlapping degree mentions in ``text``, in order, preferring longer ones."""
    candidates = [m for regex in (*_degree_regexes(), _GENERIC_DEGREE_RE) for m in regex.finditer(text)]
    candidates.sort(key=lambda m: (m.start(), -len(m.group(0))))
    found: list[re.Match[str]] = []
    for match in candidates:
        if not found or match.start() >= found[-1].end():
            found.append(match)
    return found


def _find_field(line: str, degree: re.Match[str]) -> str | None:
    rest = line[degree.end() :]
    rest = _HONOURS_RE.sub("", rest.lstrip(" .")).strip()
    parenthesised = re.match(r"^\(([^()\d]{2,60})\)", rest)
    if parenthesised and _CLASS_LEVEL_RE.match(parenthesised.group(1)):
        # "Higher Secondary (XII)" names a level, not a field of study.
        rest = rest[parenthesised.end() :]
        parenthesised = None
    if parenthesised:
        # "B.Tech (Computer Science)"
        candidate = parenthesised.group(1)
    else:
        rest = re.sub(r"^(?:[:\-–—,]\s*)?(?:in|of)\s+", "", rest.lstrip(":-–—, "), flags=re.IGNORECASE)
        end = _FIELD_END_RE.search(rest)
        candidate = rest[: end.start()] if end else rest
    candidate = collapse(candidate).strip(" .,-–—:")
    if not candidate or len(candidate) > _MAX_FIELD_LENGTH or contains_keyword(candidate, INSTITUTION_KEYWORDS):
        return None
    return candidate


def _find_institution(lines: list[str], degree_line: str | None) -> str | None:
    for line in lines:
        for part in split_parts(line):
            segments = [seg.strip() for seg in part.split(",") if seg.strip()]
            for index, segment in enumerate(segments):
                text = segment
                degree = find_degree(segment) if line == degree_line else None
                if degree:
                    text = segment[: degree.start()] + segment[degree.end() :]
                if len(segment.split()) > _MAX_INSTITUTION_WORDS or not contains_keyword(text, INSTITUTION_KEYWORDS):
                    continue
                # Keep a short place name after a comma: "XYZ University, Pune".
                following = segments[index + 1] if index + 1 < len(segments) else ""
                if (
                    following
                    and len(following.split()) <= 2
                    and following[0].isupper()
                    and not contains_keyword(following, INSTITUTION_KEYWORDS)
                    and not _GRADE_RE.search(following)
                    and not find_degree(following)
                ):
                    return f"{segment}, {following}"
                return segment

    # A single remaining header line next to the degree line is the institution:
    # "B.Tech Computer Science" / "Stanford" / "2020 - 2024".
    others = [
        line
        for line in lines
        if line != degree_line and not _GRADE_RE.search(line) and not find_degree(line) and is_header_like(line)
    ]
    if degree_line is not None and len(others) == 1 and not has_date(others[0]):
        return others[0].strip(" |,-–—")
    return None


def _parse_entry(entry: Entry) -> EducationEntry:
    raw_text = entry.raw_text
    if entry.anchor is None:
        # Neither a date nor a degree: nothing identifies this text reliably.
        return EducationEntry(rawText=raw_text)
    header = list(entry.header)

    dates = None
    for index, line in enumerate(header):
        dates = find_date_range(line)
        if dates is not None:
            header[index] = remove_span(line, dates.span)
            break
    header = [line for line in header if line]

    degree_line = next((line for line in header if find_degree(line)), None)
    degree = find_degree(degree_line) if degree_line else None
    grade = _GRADE_RE.search(raw_text)

    start = end = None
    is_current = False
    if dates is not None:
        if dates.end or dates.is_current:
            start, end, is_current = dates.start, dates.end, dates.is_current
        else:
            # A single date on a qualification is when it was (or will be) completed.
            end = dates.start

    return EducationEntry(
        degree=collapse(degree.group(0)) if degree else None,
        field=_find_field(degree_line, degree) if degree and degree_line else None,
        institution=_find_institution(header, degree_line),
        startDate=start,
        endDate=end,
        isCurrent=is_current,
        grade=collapse(grade.group(0)) if grade else None,
        rawText=raw_text,
    )


def analyze_education(section: str | None) -> list[EducationEntry]:
    if not section:
        return []

    if has_date(section):
        entries = segment_entries(section, lambda line: has_date(line) and is_header_like(line))
    else:
        # Without dates, each degree line starts a qualification; the lines after it belong to it.
        entries = segment_entries(section, lambda line: find_degree(line) is not None, max_lookback=0)
    return [_parse_entry(entry) for entry in entries]
