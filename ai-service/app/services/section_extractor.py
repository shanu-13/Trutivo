"""Dictionary-based section extraction for cleaned resume text.

A line is a section heading only when the whole line, once normalised, is a
known heading from ``app/data/sections.py``. Everything from one heading up to
the next belongs to the first heading's section. Text before the first heading
is the resume header (name, contact details) and is kept as personal
information. Text with no recognised headings yields no sections at all rather
than a guessed structure.
"""

import re
from functools import lru_cache

from app.data.sections import OTHER_SECTION_HEADINGS, SECTION_ALIASES
from app.models.resume import ExtractedSections, ResumeSections
from app.services.resume_preprocessor import preprocess_resume

# Real headings are short; this skips the matching work for ordinary lines.
_MAX_HEADING_LENGTH = 60

# Decoration seen around headings: "## Skills", "**Skills**", "SKILLS:", "— EDUCATION —".
# List bullets ("•", "-") are deliberately not stripped from the start, so a
# bullet item such as "• Leadership" inside a section is not taken as a heading.
_LEADING_DECORATION = "#*=_~|>—– \t"
_TRAILING_DECORATION = ":#*=_~|<—–- \t"

_WHITESPACE_RE = re.compile(r"\s+")
_NON_LETTER_RE = re.compile(r"[^a-z]")
_BLANK_LINE_RUN_RE = re.compile(r"\n{3,}")
_LETTER_SPACED_TOKEN_RE = re.compile(r"[A-Za-z&]")


def _normalize_heading(text: str) -> str:
    text = text.replace("&", " and ")
    return _WHITESPACE_RE.sub(" ", text).strip().casefold()


def _compact(normalized: str) -> str:
    return _NON_LETTER_RE.sub("", normalized)


class SectionMatcher:
    """Recognises section headings and maps them to canonical section keys."""

    def __init__(self, aliases: dict[str, list[str]], other_headings: list[str]):
        # Normalised heading -> canonical section key, or None for "other" headings.
        self._section_for: dict[str, str | None] = {}
        # Letters-only form, for letter-spaced headings such as "S K I L L S".
        self._compact_for: dict[str, str] = {}

        entries = [(heading, section) for section, headings in aliases.items() for heading in headings]
        entries += [(heading, None) for heading in other_headings]

        for heading, section in entries:
            key = _normalize_heading(heading)
            if not key:
                raise ValueError("Section headings cannot be empty")
            if key in self._section_for:
                raise ValueError(f"Heading {heading!r} is listed more than once")
            self._section_for[key] = section

            compact = _compact(key)
            existing = self._compact_for.get(compact)
            if existing is not None and self._section_for[existing] != section:
                raise ValueError(f"Heading {heading!r} is ambiguous with {existing!r}")
            self._compact_for.setdefault(compact, key)

    def match(self, line: str) -> tuple[str | None, str] | None:
        """Return ``(canonical_section, heading_key)`` if the line is a heading.

        ``canonical_section`` is None for recognised headings that belong in
        ``other_sections``; ``heading_key`` is then the normalised heading.
        """
        raw = line.strip()
        if not raw or len(raw) > _MAX_HEADING_LENGTH:
            return None

        text = raw.lstrip(_LEADING_DECORATION).rstrip(_TRAILING_DECORATION)
        # Headings start with a capital ("Skills", "SKILLS"); a lowercase line is
        # usually a sentence that wrapped onto its own line ("...strong technical\nskills").
        if not text or not text[0].isupper():
            return None
        # Sentences end with punctuation; headings do not.
        if text[-1] in ".,;!?":
            return None

        key = _normalize_heading(text)
        if key not in self._section_for:
            key = self._letter_spaced_key(text)
            if key is None:
                return None
        return self._section_for[key], key

    def _letter_spaced_key(self, text: str) -> str | None:
        tokens = text.split()
        if len(tokens) < 4 or not all(len(t) == 1 and _LETTER_SPACED_TOKEN_RE.match(t) for t in tokens):
            return None
        return self._compact_for.get(_compact(_normalize_heading("".join(tokens))))


def _tidy(lines: list[str]) -> str:
    """Join a section's lines, keeping its layout but trimming surrounding blank lines."""
    return _BLANK_LINE_RUN_RE.sub("\n\n", "\n".join(lines)).strip()


@lru_cache(maxsize=1)
def get_section_matcher() -> SectionMatcher:
    return SectionMatcher(SECTION_ALIASES, OTHER_SECTION_HEADINGS)


def extract_sections(text: str) -> ResumeSections:
    """Split cleaned resume text into canonical sections.

    Repeated sections are combined in the order they appear. Headings with no
    content produce no section.
    """
    matcher = get_section_matcher()

    preamble: list[str] = []
    # Each detected heading starts a new chunk: (canonical section or None, heading key, lines).
    chunks: list[tuple[str | None, str, list[str]]] = []
    for line in text.splitlines():
        heading = matcher.match(line)
        if heading is not None:
            chunks.append((*heading, []))
        elif chunks:
            chunks[-1][2].append(line)
        else:
            preamble.append(line)

    if not chunks:
        return ResumeSections()

    known: dict[str, list[str]] = {}
    other: dict[str, list[str]] = {}

    header = _tidy(preamble)
    if header:
        known["personal_information"] = [header]

    for section, key, lines in chunks:
        body = _tidy(lines)
        if not body:
            continue
        target = known if section is not None else other
        target.setdefault(section or key, []).append(body)

    fields = {
        section: "\n\n".join(known[section])
        for section in SECTION_ALIASES
        if section in known
    }
    return ResumeSections(
        **fields,
        other_sections={key: "\n\n".join(bodies) for key, bodies in other.items()},
    )


def extract_resume_sections(resume_id: str, text: str) -> ExtractedSections:
    """Preprocess raw resume text, then split it into sections."""
    cleaned = preprocess_resume(resume_id, text)
    return ExtractedSections(resumeId=resume_id, sections=extract_sections(cleaned.text))
