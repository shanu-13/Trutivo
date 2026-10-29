"""Split a projects section into individual projects.

A project starts at a short title line ("AI Resume Analyzer") that follows the
previous project's content: after its bullets, after a finished sentence, or
after a blank line. "Label:" lines such as "Tech Stack: ..." never start a
project. Technologies come from the Step 4B skill dictionary, so they use the
same canonical names as the resume's skills.
"""

import re

from app.data.resume_entities import PROJECT_LINK_LABELS, PROJECT_OTHER_LABELS, PROJECT_TECH_LABELS
from app.models.resume import ProjectEntry
from app.services.skill_extractor import extract_skills
from app.utils.dates import find_date_range, remove_span
from app.utils.entry_parsing import is_bullet, is_header_like, split_items, split_parts

_TERMINAL_PUNCTUATION = ".!?;"
_URL_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>()]{3,300}"
    r"|(?<![\w@.-])(?:github\.com|gitlab\.com|bitbucket\.org)/[\w./-]{1,200}"
    r"|(?<![\w@.-])[\w-]{1,63}\.(?:vercel\.app|netlify\.app|herokuapp\.com|github\.io|pages\.dev|onrender\.com)(?:/[\w./-]*)?"
)
_TRAILING_PARENTHESES_RE = re.compile(r"\s*\(([^()]*)\)\s*$")


def _label_regex(labels: list[str]) -> re.Pattern[str]:
    alternation = "|".join(re.escape(label) for label in sorted(labels, key=len, reverse=True))
    return re.compile(rf"^\s*(?:{alternation})\s*[:\-–]\s*", re.IGNORECASE)


_TECH_LABEL_RE = _label_regex(PROJECT_TECH_LABELS)
_LINK_LABEL_RE = _label_regex(PROJECT_LINK_LABELS)
_ANY_LABEL_RE = _label_regex(PROJECT_TECH_LABELS + PROJECT_LINK_LABELS + PROJECT_OTHER_LABELS)


def _is_link_line(line: str) -> bool:
    """A URL on its own or behind a short label: "Live: https://...", "GitHub - github.com/..."."""
    url = _URL_RE.search(line)
    if url is None:
        return False
    rest = (line[: url.start()] + line[url.end() :]).strip(" :-–—|")
    return len(rest.split()) <= 2


def _flatten(skills: dict[str, list[str]]) -> list[str]:
    return [name for names in skills.values() for name in names]


def _is_title_candidate(line: str) -> bool:
    text = line.strip()
    return (
        is_header_like(text)
        and not _ANY_LABEL_RE.match(text)
        and not _is_link_line(text)
        and not text[0].islower()
    )


def _split_projects(section: str) -> list[list[str]]:
    projects: list[list[str]] = []
    # Whether the current project has content beyond its title, and how the previous line ended.
    has_body = False
    after_break = False
    for raw in section.splitlines():
        line = raw.strip()
        if not line:
            after_break = True
            if projects:
                projects[-1].append("")
            continue

        starts_project = _is_title_candidate(line) and (
            not projects or (has_body and after_break)
        )
        if starts_project:
            projects.append([line])
            has_body = False
        elif projects:
            projects[-1].append(line)
            has_body = True
        else:
            # Content before any title line is kept as its own untitled project.
            projects.append(["", line])
            has_body = True

        after_break = (
            is_bullet(line)
            or line[-1] in _TERMINAL_PUNCTUATION
            or bool(_ANY_LABEL_RE.match(line))
            or _is_link_line(line)
        )
    return projects


def _project_name(title: str) -> str | None:
    if not title:
        return None
    dates = find_date_range(title)
    if dates is not None:
        title = remove_span(title, dates.span)
    parts = split_parts(title)
    if not parts:
        return None
    name = parts[0]
    # "Weather App (React, Node.js)": a trailing list of technologies is not part of the name.
    parentheses = _TRAILING_PARENTHESES_RE.search(name)
    if parentheses and extract_skills(parentheses.group(1)):
        name = name[: parentheses.start()].strip()
    return name or None


def _parse_project(lines: list[str]) -> ProjectEntry:
    title, body = lines[0], lines[1:]
    raw_text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()

    description_lines = [
        line
        for line in body
        if not _TECH_LABEL_RE.match(line) and not _LINK_LABEL_RE.match(line) and not _is_link_line(line)
    ]
    url = _URL_RE.search(raw_text)

    return ProjectEntry(
        name=_project_name(title),
        description=split_items(description_lines),
        technologies=_flatten(extract_skills(raw_text)),
        url=url.group(0).rstrip(".,;:") if url else None,
        rawText=raw_text,
    )


def analyze_projects(section: str | None) -> list[ProjectEntry]:
    if not section:
        return []
    return [_parse_project(lines) for lines in _split_projects(section)]
