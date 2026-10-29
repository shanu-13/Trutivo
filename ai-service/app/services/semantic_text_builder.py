"""Build plain text for embedding from structured resume and job data.

Only professional content is used: summary, experience, projects, skills and
education for a resume; title, responsibilities, skills, requirements and
description for a job. The input models have no fields for personal details,
ids or paths, so those cannot appear in the text. The output is readable text
with section headings, never JSON.

Long sections are split into chunks that fit the embedding model's input limit
(see :func:`chunk_text`).
"""

import re
from dataclasses import dataclass

from app.models.matching import SemanticJobInput, SemanticResumeInput

# all-MiniLM-L6-v2 reads at most 256 word pieces; technical words often split
# into several pieces, so chunks stay well below that.
MAX_CHUNK_WORDS = 120
# Upper bound on chunks per section, so a huge section cannot stall a request.
MAX_CHUNKS = 64

_WHITESPACE_RE = re.compile(r"[^\S\n]+")
_SENTENCE_END_RE = re.compile(r"(?<=[.!?;])\s+")


def _clean(text: str | None) -> str:
    if not text:
        return ""
    lines = (_WHITESPACE_RE.sub(" ", line).strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def _join(parts: list[str], separator: str = "\n") -> str:
    return separator.join(part for part in (_clean(p) for p in parts) if part)


def _skill_list(skills: dict[str, list[str]] | list[str]) -> list[str]:
    names = [name for group in skills.values() for name in group] if isinstance(skills, dict) else list(skills)
    unique: dict[str, str] = {}
    for name in names:
        name = name.strip()
        if name:
            unique.setdefault(name.casefold(), name)
    return list(unique.values())


def _section(heading: str, body: str) -> str:
    return f"{heading}:\n{body}" if body else ""


@dataclass(frozen=True)
class ResumeSemanticText:
    summary: str
    experience: str
    projects: str
    skills: str
    education: str

    def full(self) -> str:
        return _join(
            [
                _section("Professional Summary", self.summary),
                _section("Experience", self.experience),
                _section("Projects", self.projects),
                _section("Skills", self.skills),
                _section("Education", self.education),
            ],
            "\n\n",
        )


@dataclass(frozen=True)
class JobSemanticText:
    title: str
    responsibilities: str
    required_skills: str
    preferred_skills: str
    experience: str
    education: str
    description: str

    def full(self) -> str:
        return _join(
            [
                _section("Job Title", self.title),
                _section("Responsibilities", self.responsibilities),
                _section("Required Skills", self.required_skills),
                _section("Preferred Skills", self.preferred_skills),
                _section("Experience Requirements", self.experience),
                _section("Education Requirements", self.education),
                _section("Description", self.description),
            ],
            "\n\n",
        )

    def responsibilities_and_experience(self) -> str:
        return _join([self.responsibilities, self.experience])

    def responsibilities_and_required_skills(self) -> str:
        return _join([self.responsibilities, self.required_skills])

    def all_skills(self) -> str:
        return ", ".join(part for part in (self.required_skills, self.preferred_skills) if part)


def build_resume_text(resume: SemanticResumeInput) -> ResumeSemanticText:
    experience = []
    for job in resume.experience:
        heading = " at ".join(part for part in (job.title, job.company) if part)
        entry = _join([heading, *job.description])
        # Entries the analyzer could not structure keep their original text.
        experience.append(entry or _clean(job.rawText))

    projects = []
    for project in resume.projects:
        technologies = ", ".join(project.technologies)
        projects.append(
            _join([project.name or "", *project.description, f"Technologies: {technologies}" if technologies else ""])
        )

    education = [
        " ".join(part for part in (entry.degree, entry.field) if part) + (f", {entry.institution}" if entry.institution else "")
        for entry in resume.education
    ]

    return ResumeSemanticText(
        summary=_clean(resume.summary),
        experience=_join(experience, "\n\n"),
        projects=_join(projects, "\n\n"),
        skills=", ".join(_skill_list(resume.skills)),
        education=_join([e.strip(", ") for e in education]),
    )


def build_job_text(job: SemanticJobInput) -> JobSemanticText:
    return JobSemanticText(
        title=_clean(job.title),
        responsibilities=_join(job.responsibilities),
        required_skills=", ".join(_skill_list(job.requiredSkills)),
        preferred_skills=", ".join(_skill_list(job.preferredSkills)),
        experience=_join([r.text for r in job.experienceRequirements]),
        education=_join([r.text for r in job.educationRequirements]),
        description=_clean(job.description),
    )


def _units(text: str, max_words: int) -> list[str]:
    """Lines, split further into sentences and then word windows when too long."""
    units: list[str] = []
    for line in text.splitlines():
        if len(line.split()) <= max_words:
            units.append(line)
            continue
        for sentence in _SENTENCE_END_RE.split(line):
            words = sentence.split()
            for start in range(0, len(words), max_words):
                units.append(" ".join(words[start : start + max_words]))
    return [unit for unit in units if unit.strip()]


def chunk_text(text: str, max_words: int = MAX_CHUNK_WORDS, max_chunks: int = MAX_CHUNKS) -> tuple[list[str], bool]:
    """Split text into chunks of at most ``max_words`` words, keeping lines together.

    Returns (chunks, truncated); ``truncated`` is True only when the text needed
    more than ``max_chunks`` chunks and the rest was left out.
    """
    chunks: list[str] = []
    current: list[str] = []
    count = 0
    for unit in _units(text, max_words):
        words = len(unit.split())
        if current and count + words > max_words:
            chunks.append("\n".join(current))
            current, count = [], 0
        current.append(unit)
        count += words
    if current:
        chunks.append("\n".join(current))
    return chunks[:max_chunks], len(chunks) > max_chunks
