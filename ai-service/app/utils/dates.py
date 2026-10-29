"""Deterministic detection of resume dates and date ranges.

Supported forms: "Jan 2025", "January 2025", "Sept. 2021", "Jan '23",
"01/2025", "1-2025", "2025", and range ends such as "Present" or "Current".
Dates are returned exactly as written (whitespace collapsed), never
reformatted or completed.
"""

import re
from dataclasses import dataclass

_MONTH = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_YEAR = r"(?:19[5-9]\d|20\d\d)"
_DATE = (
    rf"(?:{_MONTH}\.?,?[ \t]*(?:{_YEAR}|'\d\d)"  # Jan 2025, January, 2025, Jan '25
    rf"|(?:0?[1-9]|1[0-2])[ \t]*[/.-][ \t]*{_YEAR}"  # 01/2025, 1-2025
    rf"|{_YEAR})"  # 2025
)
# "date" alone covers "till date"/"to date", whose first word is read as the separator.
_ONGOING = r"(?:present|current(?:ly)?|now|ongoing|today|date)"
_RANGE_SEPARATOR = r"(?:-|–|—|~|\bto\b|\btill\b|\buntil\b|\bthrough\b)"

# Dates must not be glued to other digits or letters ("12025", "Q2025", "2025th").
_LEFT = r"(?<![\w/.-])"
_RIGHT = r"(?![\w/])"

_DATE_RE = re.compile(rf"{_LEFT}{_DATE}{_RIGHT}", re.IGNORECASE)
_RANGE_RE = re.compile(
    rf"{_LEFT}(?P<start>{_DATE})[ \t]*{_RANGE_SEPARATOR}[ \t]*(?:(?P<ongoing>{_ONGOING})|(?P<end>{_DATE})){_RIGHT}",
    re.IGNORECASE,
)

_WHITESPACE_RE = re.compile(r"\s+")


def _clean(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value).strip()


@dataclass(frozen=True)
class DateRange:
    start: str | None
    end: str | None
    # True when the range ends in "Present", "Current", ...; ``end`` is then None.
    is_current: bool
    # Character span of the matched text in the searched string.
    span: tuple[int, int]


def find_date_range(text: str) -> DateRange | None:
    """Return the first date range in ``text``, or its first single date.

    A single date is reported as ``start`` with no ``end``; callers decide what
    a lone date means for their section.
    """
    match = _RANGE_RE.search(text)
    if match:
        return DateRange(
            start=_clean(match.group("start")),
            end=_clean(match.group("end")) if match.group("end") else None,
            is_current=match.group("ongoing") is not None,
            span=match.span(),
        )
    single = _DATE_RE.search(text)
    if single:
        return DateRange(start=_clean(single.group(0)), end=None, is_current=False, span=single.span())
    return None


def has_date(text: str) -> bool:
    return _DATE_RE.search(text) is not None


def has_date_range(text: str) -> bool:
    return _RANGE_RE.search(text) is not None


def remove_span(text: str, span: tuple[int, int]) -> str:
    """Remove a matched date from a line, along with the brackets or separators around it."""
    before, after = text[: span[0]], text[span[1] :]
    # "ABC (Jan 2020 - Present)" -> "ABC", "Engineer | 2021 - 2023 | Remote" -> "Engineer | Remote"
    before = re.sub(r"[\s(\[]*$", "", before)
    after = re.sub(r"^[\s)\]]*", "", after)
    before = re.sub(r"\s*(?:[|,•·:–—-]|\bfrom\b)\s*$", "", before, flags=re.IGNORECASE)
    after = re.sub(r"^\s*[|,•·–—-]\s*", "", after)
    if before and after:
        return f"{before} | {after}"
    return before or after
