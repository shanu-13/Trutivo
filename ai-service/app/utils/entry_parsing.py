"""Shared helpers for splitting a resume section into entries and items.

A section's text is a sequence of lines. Entries (one job, one degree, one
project) are found around *anchor* lines, usually the line carrying the dates.
The few short lines directly above an anchor are the entry's header (title,
company, ...). Bullets and sentences after it are the entry's body.
"""

import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Callable

# Characters that start a list item. "-" and "*" need a following space so
# that "-5%" or "*Note" are not mistaken for bullets.
_BULLET_RE = re.compile(r"^\s*(?:[•●○◦▪▫■□►▸‣⁃➢➤✓✔❖–—·]\s*|[-*+]\s+|\d{1,2}[.)]\s+)")
_TERMINAL_PUNCTUATION = ".!?;"
_WHITESPACE_RE = re.compile(r"\s+")

# Separators between the parts of a header line: "Engineer | ABC Corp", "Engineer — ABC", "Engineer at ABC".
_PART_SEPARATOR_RE = re.compile(r"\s+[|•·—–-]\s+|\s*[|•·]\s*|\s+(?:at|@)\s+")

# Header lines are short labels, not sentences.
MAX_HEADER_LENGTH = 100


def is_bullet(line: str) -> bool:
    return bool(_BULLET_RE.match(line))


def strip_bullet(line: str) -> str:
    return _BULLET_RE.sub("", line, count=1).strip()


def collapse(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def is_header_like(line: str) -> bool:
    """A short, non-bullet line that does not read like a sentence."""
    text = line.strip()
    return (
        bool(text)
        and len(text) <= MAX_HEADER_LENGTH
        and not is_bullet(text)
        and text[-1] not in _TERMINAL_PUNCTUATION
    )


def split_items(lines: list[str]) -> list[str]:
    """Turn body lines into description items.

    Each bullet starts an item. Non-bullet lines continue the previous item
    when it did not end a sentence (text wrapped by the PDF), otherwise they
    start a new item. Blank lines always end an item.
    """
    items: list[str] = []
    open_item = False
    for raw in lines:
        line = raw.strip()
        if not line:
            open_item = False
            continue
        if is_bullet(line):
            text = strip_bullet(line)
            if text:
                items.append(text)
                open_item = True
            continue
        if open_item and items and items[-1][-1] not in _TERMINAL_PUNCTUATION:
            items[-1] = f"{items[-1]} {line}"
        else:
            items.append(line)
            open_item = True
    return items


def split_lines(text: str) -> list[str]:
    """One item per non-empty line, joining lines that clearly continue the previous one."""
    items: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        text_line = strip_bullet(line) if is_bullet(line) else line
        if not text_line:
            continue
        # A line starting in lowercase or with a closing/continuing symbol wrapped from above.
        if items and not is_bullet(line) and (text_line[0].islower() or text_line[0] in "(&"):
            items[-1] = f"{items[-1]} {text_line}"
        else:
            items.append(text_line)
    return items


def split_list(text: str) -> list[str]:
    """Split a short list section ("English, Tamil, Hindi") into its items.

    Commas, semicolons, pipes and bullets separate items; commas inside
    parentheses ("English (Fluent, IELTS 8)") do not.
    """
    items: list[str] = []
    for line in split_lines(text):
        depth = 0
        current = ""
        for char in line:
            if char in "([":
                depth += 1
            elif char in ")]" and depth:
                depth -= 1
            if depth == 0 and char in ",;|•·":
                items.append(current)
                current = ""
            else:
                current += char
        items.append(current)
    return [item.strip() for item in items if item.strip()]


# Sentence ends: ". " followed by a capital, except after common abbreviations ("e.g. React").
_SENTENCE_END_RE = re.compile(r"(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\betc\.)(?<!\bvs\.)(?<=[.!?])\s+(?=[A-Z0-9(\"'])")
# Clause breaks inside a sentence: "React is required; Docker is a plus", "..., but ...".
_CLAUSE_BREAK_RE = re.compile(r"\s*;\s*|,?\s+(?:but|while|whereas|although)\s+|\s+[–—]\s+", re.IGNORECASE)


def split_clauses(text: str) -> list[str]:
    """Split one line or item into sentences, then into clauses."""
    clauses: list[str] = []
    for sentence in _SENTENCE_END_RE.split(text):
        clauses.extend(part.strip() for part in _CLAUSE_BREAK_RE.split(sentence) if part.strip())
    return clauses


def split_parts(line: str) -> list[str]:
    """Split a header line on explicit separators ("|", " — ", " at ").

    Markdown emphasis around a part ("**Lead Designer**") is removed.
    """
    parts = (part.strip(" ,").strip("*_").strip() for part in _PART_SEPARATOR_RE.split(line))
    return [part for part in parts if part]


@lru_cache(maxsize=None)
def _keyword_regex(keywords: tuple[str, ...]) -> re.Pattern[str]:
    alternation = "|".join(re.escape(k) for k in sorted(keywords, key=len, reverse=True))
    return re.compile(rf"(?<![\w.-])(?:{alternation})(?![\w-])", re.IGNORECASE)


def contains_keyword(text: str, keywords: list[str]) -> bool:
    return _keyword_regex(tuple(keywords)).search(text) is not None


def find_keyword(text: str, keywords: list[str]) -> re.Match[str] | None:
    return _keyword_regex(tuple(keywords)).search(text)


# "Chennai, India", "Austin, TX 78701", "San Francisco, CA, USA"
_PLACE_WORD = r"[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}"
_LOCATION_RE = re.compile(rf"^{_PLACE_WORD},\s*{_PLACE_WORD}(?:,\s*{_PLACE_WORD})?(?:\s+\d{{5,6}})?$")


def looks_like_location(text: str) -> bool:
    """A "City, Region" shaped phrase. Callers must rule out titles and organisations."""
    return len(text) <= 60 and bool(_LOCATION_RE.match(text.strip()))


@dataclass
class Entry:
    # Header lines in order, including the anchor line (title, company, dates, ...).
    header: list[str] = field(default_factory=list)
    # Remaining lines (bullets, sentences, blank lines).
    body: list[str] = field(default_factory=list)
    # Index into ``header`` of the anchor line, or None for entries without one.
    anchor: int | None = None

    @property
    def raw_text(self) -> str:
        text = "\n".join(self.header + self.body)
        return re.sub(r"\n{3,}", "\n\n", text).strip()


def segment_entries(
    text: str,
    is_anchor: Callable[[str], bool],
    max_lookback: int = 3,
    max_lookahead: int = 2,
) -> list[Entry]:
    """Split a section into entries around anchor lines.

    For each anchor, up to ``max_lookback`` header-like lines directly above it
    (stopping at a blank line, a bullet or the previous entry) join its header.
    When nothing precedes the anchor, up to ``max_lookahead`` header-like lines
    after it join instead ("Jan 2023 - Present" followed by "Software Engineer").

    Without any anchors, the section is split on blank lines and every
    paragraph becomes one entry with no header.
    """
    lines = text.splitlines()
    anchors = [i for i, line in enumerate(lines) if line.strip() and not is_bullet(line) and is_anchor(line)]

    if not anchors:
        entries: list[Entry] = []
        current: list[str] = []
        for line in lines + [""]:
            if line.strip():
                current.append(line)
            elif current:
                entries.append(Entry(body=current))
                current = []
        return entries

    starts: list[int] = []
    floor = 0
    for anchor in anchors:
        start = anchor
        while (
            start - 1 >= floor
            and anchor - (start - 1) <= max_lookback
            and is_header_like(lines[start - 1])
        ):
            start -= 1
        starts.append(start)
        floor = anchor + 1
    entries = []
    preamble = [line for line in lines[: starts[0]] if line.strip()]
    if all(is_header_like(line) for line in preamble):
        # Short lines above the first entry (e.g. a company heading two roles) belong to it.
        starts[0] = 0
    else:
        # Anything else is kept as its own entry rather than guessed into the first one.
        entries.append(Entry(body=lines[: starts[0]]))

    for index, (start, anchor) in enumerate(zip(starts, anchors)):
        end = starts[index + 1] if index + 1 < len(starts) else len(lines)
        header_end = anchor + 1
        if start == anchor:
            while (
                header_end < end
                and header_end - anchor <= max_lookahead
                and is_header_like(lines[header_end])
            ):
                header_end += 1
        header = [line.strip() for line in lines[start:header_end] if line.strip()]
        anchor_line = lines[anchor].strip()
        entries.append(
            Entry(
                header=header,
                body=lines[header_end:end],
                anchor=header.index(anchor_line),
            )
        )
    return entries
