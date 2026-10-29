"""Rule-based mock interview questions (Step 16).

Questions are built from the fixed frames in app/data/interview_bank.py and
facts taken from the candidate's own resume analysis and the job's extracted
requirements. Only skills named by the resume or the job are used; a job skill
the resume does not list is asked about as such, without suggesting the
candidate has used it. Roles and projects are referred to only by their names
from the resume. The same input always gives the same questions.
"""

from app.data.interview_bank import (
    BEHAVIORAL_ADVANCED_SUFFIX,
    BEHAVIORAL_GUIDANCE,
    BEHAVIORAL_LEADS,
    BEHAVIORAL_QUESTIONS,
    CATEGORY_CONCEPTS,
    GENERAL_TECHNICAL_CONCEPTS,
    GENERAL_TECHNICAL_QUESTIONS,
    GENERATOR_VERSION,
    HR_GUIDANCE,
    HR_QUESTIONS,
    MIXED_PATTERN,
    SKILL_CONCEPTS,
    STAR,
    TECHNICAL_FRAMES,
    TECHNICAL_GUIDANCE,
    TECHNICAL_LEADS,
    Concept,
)
from app.models.cover_letter import CandidateFacts, JobFacts
from app.models.interview import ExpectedPoint, Grounding, Question, QuestionRequest, QuestionSet
from app.services.skill_extractor import get_skill_matcher

LABEL_MAX = 200


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _points(concepts: list[Concept]) -> list[ExpectedPoint]:
    return [ExpectedPoint(label=label, keywords=list(keywords)) for label, keywords in concepts]


def _canonical(name: str) -> str | None:
    return get_skill_matcher().canonical(name)


def _ordered_unique(names: list[str]) -> list[str]:
    """Canonical skill names in order, without repeats; unknown names are dropped."""
    seen: set[str] = set()
    out: list[str] = []
    for name in names:
        canonical = _canonical(name)
        if canonical and canonical not in seen:
            seen.add(canonical)
            out.append(canonical)
    return out


def _resume_skills(candidate: CandidateFacts) -> list[str]:
    names = list(candidate.skills)
    for project in candidate.projects:
        names.extend(project.technologies)
    return _ordered_unique(names)


def _skills_in(text: str) -> set[str]:
    return {s for names in get_skill_matcher().extract(text).values() for s in names}


def _resume_reference(skill: str, candidate: CandidateFacts) -> str | None:
    """A role or project from the resume that mentions the skill, by its own name."""
    for role in candidate.experience:
        if role.title and skill in _skills_in(" ".join(role.highlights)):
            return f"{role.title} at {role.company}" if role.company else role.title
    for project in candidate.projects:
        if project.name and (skill in _ordered_unique(project.technologies) or skill in _skills_in(" ".join(project.highlights))):
            return f"the {project.name} project"
    return None


def _concepts_for(skill: str) -> list[Concept]:
    if skill in SKILL_CONCEPTS:
        return SKILL_CONCEPTS[skill]
    category = get_skill_matcher().category(skill)
    return CATEGORY_CONCEPTS.get(category or "", GENERAL_TECHNICAL_CONCEPTS)


def _technical_pool(req: QuestionRequest) -> tuple[list[tuple[str, str]], list[str]]:
    """(skill, source) in priority order, and the job skills the resume does not list."""
    resume = _resume_skills(req.candidate)
    resume_set = set(resume)
    required = _ordered_unique(req.job.requiredSkills)
    preferred = [s for s in _ordered_unique(req.job.preferredSkills) if s not in required]
    job = required + preferred
    pool = [(s, "resume_and_job") for s in job if s in resume_set]
    missing = [s for s in job if s not in resume_set]
    pool += [(s, "job") for s in missing]
    # Resume-only skills come last, and only when the job names few skills.
    if len(job) < 3:
        pool += [(s, "resume") for s in resume if s not in job]
    return pool, missing


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def _technical_questions(req: QuestionRequest, wanted: int) -> tuple[list[Question], list[str]]:
    pool, missing = _technical_pool(req)
    role = req.job.title
    out: list[Question] = []
    # Each round asks about the next pair of concepts of every skill, so more
    # questions than skills still gives distinct questions.
    rounds = max((len(_concepts_for(s)) + 1) // 2 for s, _ in pool) if pool else 0
    for round_index in range(rounds):
        for skill, source in pool:
            if len(out) >= wanted:
                break
            concepts = _concepts_for(skill)
            start = round_index * 2
            if start >= len(concepts):
                continue
            chosen = concepts[start : start + 2]
            reference = _resume_reference(skill, req.candidate) if source != "job" else None
            lead = TECHNICAL_LEADS[source].format(skill=skill, reference=f" (for example as {reference})" if reference else "")
            frame = TECHNICAL_FRAMES[req.difficulty].format(skill=skill, role=role, concepts="; ".join(c[0] for c in chosen))
            out.append(
                Question(
                    type="technical",
                    text=(lead + frame)[:1000],
                    focus=skill[:LABEL_MAX],
                    difficulty=req.difficulty,
                    expectedPoints=_points(chosen),
                    grounding=Grounding(source=source, skill=skill, resumeReference=reference[:LABEL_MAX] if reference else None),
                    guidance=TECHNICAL_GUIDANCE,
                )
            )
    for focus, text, concepts in GENERAL_TECHNICAL_QUESTIONS:
        if len(out) >= wanted:
            break
        out.append(
            Question(
                type="technical",
                text=text,
                focus=focus,
                difficulty=req.difficulty,
                expectedPoints=_points(concepts),
                grounding=Grounding(source="general"),
                guidance=TECHNICAL_GUIDANCE,
            )
        )
    return out, missing


def _latest_role(candidate: CandidateFacts) -> str | None:
    for role in candidate.experience:
        if role.title:
            return f"{role.title} at {role.company}" if role.company else role.title
    return None


def _behavioral_questions(req: QuestionRequest, wanted: int) -> list[Question]:
    reference = _latest_role(req.candidate)
    lead = BEHAVIORAL_LEADS["with_role"].format(reference=reference) if reference else BEHAVIORAL_LEADS["general"]
    out: list[Question] = []
    for focus, prompt, extra in BEHAVIORAL_QUESTIONS[:wanted]:
        text = _cap(lead + prompt)
        if req.difficulty == "advanced":
            text += BEHAVIORAL_ADVANCED_SUFFIX
        out.append(
            Question(
                type="behavioral",
                text=text[:1000],
                focus=focus,
                difficulty=req.difficulty,
                expectedPoints=_points(STAR + extra),
                grounding=Grounding(source="resume" if reference else "general", resumeReference=reference[:LABEL_MAX] if reference else None),
                guidance=BEHAVIORAL_GUIDANCE,
            )
        )
    return out


def _hr_questions(job: JobFacts, difficulty: str, wanted: int) -> list[Question]:
    at_company = f" at {job.companyName}" if job.companyName else ""
    return [
        Question(
            type="hr",
            text=frame.format(role=job.title, at_company=at_company)[:1000],
            focus=focus,
            difficulty=difficulty,
            expectedPoints=_points(concepts),
            grounding=Grounding(source="job"),
            guidance=HR_GUIDANCE,
        )
        for focus, frame, concepts in HR_QUESTIONS[:wanted]
    ]


def generate_questions(req: QuestionRequest) -> QuestionSet:
    if req.interviewType == "mixed":
        plan = [MIXED_PATTERN[i % len(MIXED_PATTERN)] for i in range(req.count)]
    else:
        plan = [req.interviewType] * req.count
    wanted = {kind: plan.count(kind) for kind in ("technical", "behavioral", "hr")}

    technical, _ = _technical_questions(req, wanted["technical"]) if wanted["technical"] else ([], [])
    available = {
        "technical": technical,
        "behavioral": _behavioral_questions(req, wanted["behavioral"]),
        "hr": _hr_questions(req.job, req.difficulty, wanted["hr"]),
    }
    # Interleave in plan order; a type that runs out is simply skipped.
    questions: list[Question] = []
    taken = {kind: 0 for kind in available}
    seen: set[str] = set()
    for kind in plan:
        items = available[kind]
        if taken[kind] < len(items):
            question = items[taken[kind]]
            taken[kind] += 1
            if question.text not in seen:
                seen.add(question.text)
                questions.append(question)

    notes: list[str] = []
    asked_missing = [q.focus for q in questions if q.grounding.source == "job" and q.type == "technical"]
    if asked_missing:
        notes.append(
            f"Questions about {_join(sorted(set(asked_missing)))} come from the job description only; your resume does not list "
            f"{'it' if len(set(asked_missing)) == 1 else 'them'}. Answer honestly about your level of experience."
        )
    if len(questions) < req.count:
        notes.append(f"Only {len(questions)} distinct questions could be prepared for this interview type and these documents.")
    return QuestionSet(generatorVersion=GENERATOR_VERSION, questions=questions, notes=notes)
