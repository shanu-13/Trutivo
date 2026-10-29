"""Deterministic job title extraction.

A title stored by the user always wins. Otherwise the title is taken only from
an explicit "Job Title: ..." label, a first line that reads as a title
("Senior React Developer"), or a "looking for a <Title>" phrase. Anything less
clear returns None.
"""

import re
from functools import lru_cache

from app.data.job_sections import JOB_TITLE_LABELS
from app.data.resume_entities import JOB_TITLE_KEYWORDS
from app.utils.entry_parsing import collapse, contains_keyword, is_header_like, split_parts

_MAX_TITLE_WORDS = 8
_MAX_TITLE_LENGTH = 100
# "We are looking for a Frontend Developer with ..." -> "Frontend Developer" (capitalised words only).
_HIRING_PHRASE_RE = re.compile(
    r"\b(?:looking\s+for|seeking|hiring|searching\s+for|recruiting)\s+(?:an?\s+|our\s+(?:next|new)\s+|a\s+talented\s+|an\s+experienced\s+)?"
    r"(?P<title>(?:[A-Z][\w.+#/-]*\s+){0,4}[A-Z][\w+#/-]*)"
)


@lru_cache(maxsize=1)
def _label_re() -> re.Pattern[str]:
    labels = "|".join(re.escape(label) for label in sorted(JOB_TITLE_LABELS, key=len, reverse=True))
    return re.compile(rf"^\s*(?:{labels})\s*[:\-–]\s*(?P<value>\S.*)$", re.IGNORECASE)


def _ends_with_title_word(text: str) -> bool:
    words = text.split()
    return bool(words) and contains_keyword(words[-1], JOB_TITLE_KEYWORDS)


_TRAILING_PARENTHESES_RE = re.compile(r"\s*\([^()]*\)\s*$")


def _as_title(text: str) -> str | None:
    # "Data Scientist (Full-time, Remote)": the bracketed details are not part of the title.
    text = _TRAILING_PARENTHESES_RE.sub("", collapse(text)).strip(" -–—|:#*")
    if (
        not text
        or len(text) > _MAX_TITLE_LENGTH
        or len(text.split()) > _MAX_TITLE_WORDS
        or not is_header_like(text)
        or not contains_keyword(text, JOB_TITLE_KEYWORDS)
    ):
        return None
    return text


def extract_job_title(text: str, provided_title: str | None = None) -> str | None:
    if provided_title and provided_title.strip():
        return provided_title.strip()

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        labelled = _label_re().match(line)
        if labelled:
            title = _as_title(labelled.group("value"))
            if title:
                return title

    if lines:
        # "Frontend Developer - Example Technologies": the part naming a role.
        for part in split_parts(lines[0]):
            title = _as_title(part)
            if title and _ends_with_title_word(title):
                return title

    for line in lines:
        phrase = _HIRING_PHRASE_RE.search(line)
        if phrase and _ends_with_title_word(phrase.group("title")):
            title = _as_title(phrase.group("title"))
            if title:
                return title
    return None
