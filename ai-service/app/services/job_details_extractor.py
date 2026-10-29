"""Optional job details: location, employment type and work mode.

These come only from explicit wording: a "Location: ..." style label, or an
unambiguous phrase such as "This is a full-time position" or "fully remote".
Missing details stay None.
"""

import re
from functools import lru_cache

from app.data.job_sections import (
    EMPLOYMENT_TYPE_LABELS,
    EMPLOYMENT_TYPES,
    LOCATION_LABELS,
    WORK_MODE_LABELS,
    WORK_MODES,
)
from app.utils.entry_parsing import collapse

_MAX_VALUE_LENGTH = 100


def _alternation(words: list[str]) -> str:
    return "|".join(re.escape(word) for word in sorted(words, key=len, reverse=True))


@lru_cache(maxsize=None)
def _label_re(labels: tuple[str, ...]) -> re.Pattern[str]:
    return re.compile(rf"^\s*(?:{_alternation(list(labels))})\s*[:\-–]\s*(?P<value>\S.*)$", re.IGNORECASE)


@lru_cache(maxsize=None)
def _canonical_re(canonical: str, words: tuple[str, ...]) -> re.Pattern[str]:
    return re.compile(rf"(?<![\w-])(?:{_alternation(list(words))})(?![\w-])", re.IGNORECASE)


def _labelled(lines: list[str], labels: list[str]) -> str | None:
    for line in lines:
        match = _label_re(tuple(labels)).match(line)
        if match:
            value = collapse(match.group("value"))
            if len(value) <= _MAX_VALUE_LENGTH:
                return value
    return None


def _canonical(text: str, vocabulary: dict[str, list[str]]) -> str | None:
    """The single canonical value named in ``text``; None if none or several are named."""
    found = [name for name, words in vocabulary.items() if _canonical_re(name, tuple(words)).search(text)]
    return found[0] if len(found) == 1 else None


# Phrases that state a work mode or employment type outright.
_WORK_MODE_PHRASE_RE = re.compile(
    r"\b(?:fully\s+remote|100%\s+remote|remote-first|remote\s+(?:position|role|job|opportunity)"
    r"|hybrid\s+(?:position|role|job|model|work|working)|(?:on-?site|in-office)\s+(?:position|role|job))\b",
    re.IGNORECASE,
)
_EMPLOYMENT_PHRASE_RE = re.compile(
    r"\b(?:full[\s-]?time|part[\s-]?time|contract|freelance|internship|temporary)\s+(?:position|role|job|opportunity|employment|basis|contract)\b",
    re.IGNORECASE,
)


def extract_job_details(text: str) -> tuple[str | None, str | None, str | None]:
    """Return (location, employment_type, work_mode)."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    location = _labelled(lines, LOCATION_LABELS)

    work_mode_label = _labelled(lines, WORK_MODE_LABELS)
    work_mode = _canonical(work_mode_label, WORK_MODES) if work_mode_label else None
    if work_mode is None and location:
        work_mode = _canonical(location, WORK_MODES)
    if work_mode is None:
        phrases = " ".join(m.group(0) for m in _WORK_MODE_PHRASE_RE.finditer(text))
        work_mode = _canonical(phrases, WORK_MODES) if phrases else None

    type_label = _labelled(lines, EMPLOYMENT_TYPE_LABELS)
    employment_type = _canonical(type_label, EMPLOYMENT_TYPES) if type_label else None
    if employment_type is None:
        phrases = " ".join(m.group(0) for m in _EMPLOYMENT_PHRASE_RE.finditer(text))
        employment_type = _canonical(phrases, EMPLOYMENT_TYPES) if phrases else None

    return location, employment_type, work_mode
