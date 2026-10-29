"""Rule-based cover letter composition (Step 12).

The letter is assembled from the fixed frames in
app/data/cover_letter_templates.py and facts from the candidate's own resume:
job skills that the resume also lists, the candidate's roles and projects,
their own description lines (rephrased in the first person only when that is
safe), education and certifications. Nothing is generated freely, so nothing
can be invented; `verify_letter` then checks the finished text before it is
returned: every skill it names must be in the resume, and every number must
come from the resume or the job title. Where a fact is unknown (why the
candidate wants this employer, a missing name) a bracketed placeholder is used.
"""

import re

from app.data.cover_letter_templates import (
    CERTIFICATIONS,
    CLOSING,
    CURRENT_ROLE,
    EDUCATION_BACKGROUND,
    GREETING,
    IRREGULAR_PAST,
    LENGTH_PLAN,
    MAX_LETTER_CHARS,
    MOTIVATION_PLACEHOLDER,
    NAME_PLACEHOLDER,
    OPENING,
    PROJECT_EVIDENCE,
    PROJECT_TECHNOLOGIES,
    RECENT_ROLE,
    ROLE_EVIDENCE,
    ROLE_SKILLS,
    SIGN_OFF,
    SKILLS_GENERAL,
    SKILLS_MATCH,
    SKILLS_PREFERRED,
)
from app.models.cover_letter import CoverLetter, CoverLetterRequest, ExperienceFact, ProjectFact, UsedFacts
from app.services.skill_extractor import get_skill_matcher
from app.utils.responses import AppError

_PLACEHOLDER_RE = re.compile(r"\[[^\]]+\]")


def _key(skill: str) -> str:
    matcher = get_skill_matcher()
    canonical = matcher.canonical(skill)
    return (canonical or skill).strip().lower()


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _at(company: str | None) -> str:
    return f" at {company}" if company else ""


def _first_person_clause(line: str) -> str | None:
    """'Built the refunds API.' -> 'built the refunds API'; None unless the line starts with a past-tense verb."""
    text = line.strip().rstrip(".;:")
    words = text.split()
    if len(words) < 3:
        return None
    first = words[0]
    lowered = first.lower()
    if not (first[0].isupper() and first[1:].islower()):
        return None
    if not (lowered.endswith("ed") or lowered in IRREGULAR_PAST):
        return None
    return lowered + text[len(first):]


def _skills_in(text: str) -> set[str]:
    return {s.lower() for names in get_skill_matcher().extract(text).values() for s in names}


def _education_label(degree: str | None, field: str | None, institution: str | None) -> str | None:
    label = degree or ""
    if field and field.lower() not in label.lower():
        label = f"{label} in {field}" if label else field
    if not label:
        return None
    return f"{label}{f' from {institution}' if institution else ''}"


def _role_relevance(entry: ExperienceFact | ProjectFact, wanted: set[str]) -> int:
    text = " ".join([getattr(entry, "title", None) or getattr(entry, "name", None) or "", *entry.highlights, *getattr(entry, "technologies", [])])
    return len(_skills_in(text) & wanted)


def _pick_lines(highlights: list[str], wanted: set[str], count: int) -> list[str]:
    """The candidate's own lines that can be phrased in the first person, most relevant first."""
    usable = [(len(_skills_in(h) & wanted), i, clause) for i, h in enumerate(highlights) if (clause := _first_person_clause(h))]
    usable.sort(key=lambda item: (-item[0], item[1]))
    return [clause for _, _, clause in usable[:count]]


def compose_cover_letter(request: CoverLetterRequest) -> CoverLetter:
    candidate, job, tone, length = request.candidate, request.job, request.tone, request.length
    plan = LENGTH_PLAN[length]
    used = UsedFacts()
    notes: list[str] = []

    candidate_keys = {_key(s): s for s in candidate.skills}
    required = [s for s in job.requiredSkills if _key(s) in candidate_keys]
    preferred = [s for s in job.preferredSkills if _key(s) in candidate_keys and s not in required]
    missing = [s for s in job.requiredSkills if _key(s) not in candidate_keys]
    wanted = {_key(s) for s in [*job.requiredSkills, *job.preferredSkills]}
    if missing:
        notes.append(
            f"The job also lists {_join(missing)}, which your resume does not show; the letter does not claim "
            f"{'it' if len(missing) == 1 else 'them'}. Add {'it' if len(missing) == 1 else 'them'} only if true."
        )

    company = job.companyName
    opening = [OPENING[tone].format(role=job.title, at=_at(company))]

    roles = [e for e in candidate.experience if e.title]
    if roles:
        latest = roles[0]
        frame = CURRENT_ROLE if latest.isCurrent else RECENT_ROLE
        opening.append(frame.format(title=latest.title, at=_at(latest.company)))
        used.experience.append(f"{latest.title}{_at(latest.company)}")
    else:
        for edu in candidate.education:
            label = _education_label(edu.degree, edu.field, edu.institution)
            if label:
                opening.append(EDUCATION_BACKGROUND.format(education=label))
                used.education.append(label)
                break

    # Skills: only job skills the resume also lists.
    fit: list[str] = []
    if required:
        shown = required[:5]
        fit.append(
            SKILLS_MATCH[tone].format(
                skills=_join(shown),
                which="which is" if len(shown) == 1 else "all of which are",
                these="this is a" if len(shown) == 1 else "these are",
            ).replace("this is a skills", "this is a skill")
        )
        used.skills.extend(shown)
        if preferred and length != "short":
            fit.append(SKILLS_PREFERRED.format(skills=_join(preferred[:3])))
            used.skills.extend(preferred[:3])
    elif preferred:
        fit.append(SKILLS_PREFERRED.format(skills=_join(preferred[:3])))
        used.skills.extend(preferred[:3])
    elif candidate.skills:
        fit.append(SKILLS_GENERAL.format(skills=_join(candidate.skills[:4])))
        used.skills.extend(candidate.skills[:4])

    # Evidence from the most relevant roles, in the candidate's own (rephrased) words.
    evidence: list[str] = []
    # The most relevant roles, presented in resume order (most recent first).
    ranked_roles = sorted(enumerate(roles), key=lambda item: (-_role_relevance(item[1], wanted), item[0]))[: plan["roles"]]
    for _, role in sorted(ranked_roles, key=lambda item: item[0]):
        clauses = _pick_lines(role.highlights, wanted, plan["lines_per_role"])
        if clauses:
            at_cap = f"At {role.company}" if role.company else f"In my role as {role.title}"
            first = ROLE_EVIDENCE[tone].format(title=role.title, at=_at(role.company), At_cap=at_cap, clause=clauses[0])
            evidence.append(first + "".join(f" I also {c}." for c in clauses[1:]))
        else:
            role_skills = [s for s in candidate.skills if _key(s) in _skills_in(" ".join([role.title or "", *role.highlights]))]
            if not role_skills:
                continue
            evidence.append(ROLE_SKILLS.format(title=role.title, at=_at(role.company), skills=_join(role_skills[:4])))
        label = f"{role.title}{_at(role.company)}"
        if label not in used.experience:
            used.experience.append(label)

    project_count = plan["projects"] or (1 if not evidence else 0)
    ranked_projects = sorted(
        (p for p in enumerate(candidate.projects) if p[1].name),
        key=lambda item: (-_role_relevance(item[1], wanted), item[0]),
    )
    project_sentences: list[str] = []
    for _, project in sorted(ranked_projects[:project_count], key=lambda item: item[0]):
        clauses = _pick_lines(project.highlights, wanted, 1)
        if clauses:
            project_sentences.append(PROJECT_EVIDENCE.format(name=project.name, clause=clauses[0]))
        elif project.technologies:
            relevant = [t for t in project.technologies if _key(t) in wanted] or project.technologies
            project_sentences.append(PROJECT_TECHNOLOGIES.format(name=project.name, skills=_join(relevant[:4])))
        else:
            continue
        used.projects.append(project.name)

    extras: list[str] = []
    if plan["education"] and roles:
        for edu in candidate.education:
            label = _education_label(edu.degree, edu.field, edu.institution)
            if label:
                extras.append(EDUCATION_BACKGROUND.format(education=label))
                used.education.append(label)
                break
    if plan["certifications"] and candidate.certifications:
        names = candidate.certifications[:3]
        extras.append(CERTIFICATIONS.format(s="s" if len(names) > 1 else "", names=_join(names)))
        used.certifications.extend(names)

    target = company or "your team"
    closing = []
    if plan["motivation"]:
        closing.append(MOTIVATION_PLACEHOLDER.format(company=company or "your organisation"))
    closing.append(CLOSING[tone].format(company=target))

    paragraphs = [GREETING, " ".join(opening)]
    if length == "short":
        paragraphs.append(" ".join([*fit, *evidence[:1], *([] if evidence else project_sentences[:1])]))
    else:
        paragraphs.append(" ".join([*fit, *evidence[:1]]))
        rest = [*evidence[1:], *project_sentences, *extras]
        if rest:
            paragraphs.append(" ".join(rest))
    paragraphs.append(" ".join(closing))
    paragraphs.append(f"{SIGN_OFF[tone]}\n{candidate.name or NAME_PLACEHOLDER}")
    paragraphs = [p for p in paragraphs if p.strip()]

    text = "\n\n".join(paragraphs)
    verify_letter(text, request)
    return CoverLetter(
        tone=tone,
        length=length,
        paragraphs=paragraphs,
        text=text,
        wordCount=len(re.findall(r"\S+", _PLACEHOLDER_RE.sub("", text))),
        placeholders=_PLACEHOLDER_RE.findall(text),
        usedFacts=used,
        notes=notes,
    )


def verify_letter(text: str, request: CoverLetterRequest) -> None:
    """Rejects a letter that names a skill or a number the candidate's facts do not contain."""
    candidate, job = request.candidate, request.job
    if len(text) > MAX_LETTER_CHARS or not text.strip():
        raise AppError(500, "COVER_LETTER_INVALID", "The generated cover letter failed validation")

    facts = " ".join(
        [
            *candidate.skills,
            *candidate.certifications,
            *(x for e in candidate.experience for x in [e.title or "", e.company or "", *e.highlights]),
            *(x for p in candidate.projects for x in [p.name or "", *p.technologies, *p.highlights]),
            *(x for e in candidate.education for x in [e.degree or "", e.field or "", e.institution or ""]),
        ]
    )
    # The job title and company may name a skill or a number ("Python Developer", "3M"); they are not claims.
    claims = _PLACEHOLDER_RE.sub(" ", text)
    for given in filter(None, [job.title, job.companyName]):
        claims = claims.replace(given, " ")
    allowed_skills = _skills_in(facts) | {_key(s) for s in candidate.skills}
    if _skills_in(claims) - allowed_skills:
        raise AppError(500, "COVER_LETTER_INVALID", "The generated cover letter failed validation")
    if set(re.findall(r"\d+(?:[.,]\d+)?", claims)) - set(re.findall(r"\d+(?:[.,]\d+)?", facts)):
        raise AppError(500, "COVER_LETTER_INVALID", "The generated cover letter failed validation")
