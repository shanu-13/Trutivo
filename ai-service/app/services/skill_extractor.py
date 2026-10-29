"""Dictionary-based skill extraction for cleaned resume text.

Every canonical skill name and alias is compiled into a single regular
expression. Terms are tried longest first so that, at any position, the most
specific term wins ("JavaScript" before "Java", "ASP.NET Core" before ".NET").
Custom boundaries are used instead of ``\\b`` because many skills contain
symbols ("C++", "C#", ".NET", "Node.js", "CI/CD") that ``\\b`` handles badly.
"""

import re
from functools import lru_cache

from app.data.skills import CASE_SENSITIVE_TERMS, SKILL_ALIASES, SKILLS
from app.models.resume import ExtractedSkills
from app.services.resume_preprocessor import preprocess_resume

# A term must not be glued to a preceding letter/digit or symbol that could be
# part of another skill name: this stops "js" matching inside "Node.js" and
# "NET" matching inside "ASP.NET".
_LEFT_BOUNDARY = r"(?<![A-Za-z0-9_.+#])"
# A term must not continue into another word or symbol ("Java" in "JavaScript",
# "C" in "C++"/"C#"). A trailing "." is fine when it ends a sentence, but not
# when it joins another word ("Node" in "Node.js").
_RIGHT_BOUNDARY = r"(?![A-Za-z0-9_+#])(?!\.[A-Za-z0-9])"

_WHITESPACE_RE = re.compile(r"\s+")


def _lookup_key(term: str) -> str:
    return _WHITESPACE_RE.sub(" ", term).strip().casefold()


class SkillMatcher:
    """Pre-compiled matcher built from a skill dictionary and alias table."""

    def __init__(
        self,
        skills: dict[str, list[str]],
        aliases: dict[str, str],
        case_sensitive: set[str],
    ):
        self._category_of: dict[str, str] = {}
        # Position of each canonical skill in the dictionary, used to order results.
        self._rank: dict[str, int] = {}
        for category, names in skills.items():
            for name in names:
                if name in self._category_of:
                    raise ValueError(f"Skill {name!r} is listed in more than one category")
                self._category_of[name] = category
                self._rank[name] = len(self._rank)

        self._canonical_for: dict[str, str] = {}
        terms = [(name, name) for name in self._category_of]
        for alias, canonical in aliases.items():
            if canonical not in self._category_of:
                raise ValueError(f"Alias {alias!r} points to unknown skill {canonical!r}")
            terms.append((alias, canonical))

        for term, canonical in terms:
            key = _lookup_key(term)
            existing = self._canonical_for.get(key)
            if existing is not None and existing != canonical:
                raise ValueError(f"Term {term!r} maps to both {existing!r} and {canonical!r}")
            self._canonical_for[key] = canonical

        unknown = case_sensitive - {term for term, _ in terms}
        if unknown:
            raise ValueError(f"Case-sensitive terms are not skills or aliases: {sorted(unknown)}")

        self._case_sensitive = case_sensitive
        ordered = sorted({term for term, _ in terms}, key=lambda term: (-len(term), term))
        alternation = "|".join(self._pattern(term) for term in ordered)
        self._regex = re.compile(f"{_LEFT_BOUNDARY}(?:{alternation}){_RIGHT_BOUNDARY}")

    def _pattern(self, term: str) -> str:
        # Spaces inside a term also match line breaks and repeated spaces.
        body = r"\s+".join(re.escape(part) for part in term.split())
        if term in self._case_sensitive:
            # Ambiguous words are usually prose when hyphenated: "Go-to", "C-suite".
            return f"{body}(?!-)"
        return f"(?i:{body})"

    def extract(self, text: str) -> dict[str, list[str]]:
        """Return detected canonical skills grouped by category.

        Categories and skills follow dictionary order, each skill appears once,
        and categories with no detected skills are omitted.
        """
        found = {self._canonical_for[_lookup_key(m.group(0))] for m in self._regex.finditer(text)}

        grouped: dict[str, list[str]] = {}
        for name in sorted(found, key=self._rank.__getitem__):
            grouped.setdefault(self._category_of[name], []).append(name)
        return grouped

    def canonical(self, name: str) -> str | None:
        """The canonical name for a skill name or alias ("reactjs" -> "React"), or None if unknown."""
        return self._canonical_for.get(_lookup_key(name))

    def category(self, canonical_name: str) -> str | None:
        """The dictionary category of a canonical skill name, or None if unknown."""
        return self._category_of.get(canonical_name)

    def extract_in_order(self, text: str) -> list[str]:
        """Return detected canonical skills once each, in the order they first appear."""
        ordered: dict[str, None] = {}
        for match in self._regex.finditer(text):
            ordered.setdefault(self._canonical_for[_lookup_key(match.group(0))], None)
        return list(ordered)


@lru_cache(maxsize=1)
def get_skill_matcher() -> SkillMatcher:
    return SkillMatcher(SKILLS, SKILL_ALIASES, CASE_SENSITIVE_TERMS)


def extract_skills(text: str) -> dict[str, list[str]]:
    """Detect known skills in cleaned resume text, grouped by category."""
    return get_skill_matcher().extract(text)


def extract_skills_in_order(text: str) -> list[str]:
    """Detect known skills in text, uncategorised, in order of first appearance."""
    return get_skill_matcher().extract_in_order(text)


def canonical_skill(name: str) -> str | None:
    return get_skill_matcher().canonical(name)


def skill_category(canonical_name: str) -> str | None:
    return get_skill_matcher().category(canonical_name)


def extract_resume_skills(resume_id: str, text: str) -> ExtractedSkills:
    """Preprocess raw resume text, then extract its skills."""
    cleaned = preprocess_resume(resume_id, text)
    skills = extract_skills(cleaned.text)
    return ExtractedSkills(
        resumeId=resume_id,
        skills=skills,
        totalSkills=sum(len(names) for names in skills.values()),
    )
