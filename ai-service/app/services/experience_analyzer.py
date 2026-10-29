"""Split an experience section into individual jobs.

Each job is anchored on its date line. When a section has date ranges
("Jan 2023 - Present"), only those anchor entries; lone dates are used only
when no ranges exist, so a year mentioned in a description does not start a
new job. Title and company are identified by keywords ("Engineer", "Ltd") and
explicit separators ("|", " at "). When they cannot be told apart, they are
left as None and the entry's ``rawText`` keeps the original text.
"""

from app.data.resume_entities import JOB_TITLE_KEYWORDS, ORGANIZATION_KEYWORDS, WORK_ARRANGEMENTS
from app.models.resume import ExperienceEntry
from app.utils.dates import find_date_range, has_date, has_date_range, remove_span
from app.utils.entry_parsing import (
    Entry,
    contains_keyword,
    is_header_like,
    looks_like_location,
    segment_entries,
    split_items,
    split_parts,
)

_ARRANGEMENTS = {word.casefold() for word in WORK_ARRANGEMENTS}
_MAX_LOCATION_WORDS = 3


def _is_title(text: str) -> bool:
    return contains_keyword(text, JOB_TITLE_KEYWORDS)


def _is_organization(text: str) -> bool:
    return contains_keyword(text, ORGANIZATION_KEYWORDS)


def _is_location(text: str) -> bool:
    return text.casefold() in _ARRANGEMENTS or (
        looks_like_location(text) and not _is_title(text) and not _is_organization(text)
    )


def _expand_commas(parts: list[str]) -> tuple[list[str], str | None]:
    """Split "Engineer, ABC Corp" and "ABC Corp, Pune" where the comma clearly separates fields."""
    expanded: list[str] = []
    location = None
    for part in parts:
        left, sep, right = part.partition(",")
        left, right = left.strip(), right.strip()
        if sep and left and right:
            if _is_title(left) and not _is_title(right):
                expanded += [left, right]
                continue
            if (
                _is_organization(left)
                and not _is_organization(right)
                and not _is_title(right)
                and len(right.split()) <= _MAX_LOCATION_WORDS
            ):
                expanded.append(left)
                location = location or right
                continue
        expanded.append(part)
    return expanded, location


def _assign_fields(parts: list[str]) -> tuple[str | None, str | None, str | None]:
    """Return (title, company, location) from an entry's header parts."""
    parts, location = _expand_commas(parts)

    remaining = []
    for part in parts:
        if _is_location(part):
            location = location or part
        else:
            remaining.append(part)

    title = next((p for p in remaining if _is_title(p)), None)
    others = [p for p in remaining if p is not title]
    company = next((p for p in others if _is_organization(p)), None)
    if company is None and title is not None and others:
        # "Software Engineer" + "Google": the part that is not the title is the employer.
        company = others[0]
    return title, company, location


def _parse_entry(entry: Entry) -> ExperienceEntry:
    if entry.anchor is None:
        # No dates: only a first line with an explicit "Title | Company" shape is parsed.
        lines = [line.strip() for line in entry.body if line.strip()]
        first = lines[0] if lines else ""
        parts = split_parts(first) if is_header_like(first) else []
        if len(parts) >= 2 and any(_is_title(p) for p in parts):
            title, company, location = _assign_fields(parts)
            return ExperienceEntry(
                title=title,
                company=company,
                location=location,
                description=split_items(lines[1:]),
                rawText=entry.raw_text,
            )
        return ExperienceEntry(description=split_items(entry.body), rawText=entry.raw_text)

    anchor_line = entry.header[entry.anchor]
    dates = find_date_range(anchor_line)
    header_lines = list(entry.header)
    if dates is not None:
        header_lines[entry.anchor] = remove_span(anchor_line, dates.span)

    parts = [part for line in header_lines for part in split_parts(line)]
    title, company, location = _assign_fields(parts)

    return ExperienceEntry(
        title=title,
        company=company,
        location=location,
        startDate=dates.start if dates else None,
        endDate=dates.end if dates else None,
        isCurrent=dates.is_current if dates else False,
        description=split_items(entry.body),
        rawText=entry.raw_text,
    )


def analyze_experience(section: str | None) -> list[ExperienceEntry]:
    if not section:
        return []

    if has_date_range(section):
        def is_anchor(line: str) -> bool:
            return has_date_range(line)
    else:
        def is_anchor(line: str) -> bool:
            return is_header_like(line) and has_date(line)

    return [_parse_entry(entry) for entry in segment_entries(section, is_anchor)]
