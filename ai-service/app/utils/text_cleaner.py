"""Small, composable text-cleaning functions for extracted resume and job description text.

These functions only normalise formatting. They never try to interpret the
content (skills, education, experience, ...), which is left to later stages.
"""

import re
import unicodedata

# Typographic ligatures that PDF extractors frequently emit.
_LIGATURES = {
    "ﬀ": "ff",
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "ﬅ": "st",
    "ﬆ": "st",
}

# Invisible characters that carry no meaning in plain text.
_INVISIBLE_CHARS = {
    "­",  # soft hyphen
    "​",  # zero-width space
    "‌",  # zero-width non-joiner
    "‍",  # zero-width joiner
    "⁠",  # word joiner
    "﻿",  # byte order mark / zero-width no-break space
}

# Line and page separators, including form feeds that pdf text extraction uses between pages.
_LINE_BREAK_RE = re.compile(r"\r\n|\r|[\u0085  \x0b\x0c]")

# Tabs and every Unicode space separator (NBSP, en/em spaces, ...), excluding newlines.
_HORIZONTAL_SPACE_RE = re.compile(r"[^\S\n]+")

_BLANK_LINE_RUN_RE = re.compile(r"\n{3,}")


def normalize_line_endings(text: str) -> str:
    """Convert Windows, old Mac and Unicode line/page separators to ``\\n``."""
    return _LINE_BREAK_RE.sub("\n", text)


def normalize_unicode(text: str) -> str:
    """Apply NFC normalisation, expand ligatures and drop invisible/control characters.

    NFC is used rather than NFKC so that meaningful symbols such as ``™``,
    ``²`` or ``½`` are preserved instead of being rewritten.
    """
    text = unicodedata.normalize("NFC", text)
    text = "".join(_LIGATURES.get(ch, ch) for ch in text)
    return "".join(
        ch
        for ch in text
        if ch not in _INVISIBLE_CHARS
        and (ch in "\n\t" or unicodedata.category(ch) != "Cc")
    )


def normalize_text(text: str) -> str:
    """Normalise line endings and Unicode representation."""
    return normalize_unicode(normalize_line_endings(text))


def normalize_whitespace(text: str) -> str:
    """Collapse runs of spaces/tabs to one space and trim each line.

    Line breaks are kept so the resume layout stays readable.
    """
    lines = (_HORIZONTAL_SPACE_RE.sub(" ", line).strip() for line in text.split("\n"))
    return "\n".join(lines)


def remove_excessive_blank_lines(text: str) -> str:
    """Reduce any run of blank lines to a single blank line.

    Expects whitespace-only lines to have already been emptied by
    :func:`normalize_whitespace`.
    """
    return _BLANK_LINE_RUN_RE.sub("\n\n", text)


def clean_resume_text(text: str) -> str:
    """Run the full cleaning pipeline and return trimmed, readable text."""
    text = normalize_text(text)
    text = normalize_whitespace(text)
    text = remove_excessive_blank_lines(text)
    return text.strip()
