"""Deterministic comparison of a structured resume with structured job requirements.

Skills on both sides are resolved through the Step 4B dictionary ("reactjs",
"REACT" and "React" are all "React"), so matching is exact on canonical names:
"JavaScript" never matches "Java". The result is a factual comparison (what is
matched, what is missing, and simple coverage percentages) with no overall
score or rating.
"""

from datetime import date

from app.models.matching import (
    CategorySkills,
    JobRequirementsInput,
    MatchingRequest,
    MatchingResult,
    MatchingSummary,
    ResumeMatchInput,
    SkillComparison,
    SkillsMatch,
)
from app.services.education_matcher import compare_education
from app.services.experience_matcher import compare_experience
from app.services.skill_extractor import canonical_skill, skill_category

# Skills a job names that are not in the skill dictionary keep their own name
# and are grouped here.
UNCATEGORIZED = "uncategorized"


def _canonical_list(names: list[str]) -> list[str]:
    """Canonical names in order, once each; unknown names are kept as written."""
    seen: dict[str, str] = {}
    for name in names:
        name = name.strip()
        if not name:
            continue
        canonical = canonical_skill(name) or name
        seen.setdefault(canonical.casefold(), canonical)
    return list(seen.values())


def resume_skill_names(resume: ResumeMatchInput) -> list[str]:
    skills = resume.skills
    names = [name for group in skills.values() for name in group] if isinstance(skills, dict) else list(skills)
    return _canonical_list(names)


def _coverage(matched: int, total: int) -> int | float | None:
    if total == 0:
        # No skills to cover: 0% would wrongly say none were matched.
        return None
    value = round(matched / total * 100, 1)
    return int(value) if value.is_integer() else value


def compare_skills(job_skills: list[str], candidate: set[str]) -> SkillComparison:
    wanted = _canonical_list(job_skills)
    candidate_folded = {name.casefold() for name in candidate}
    matched = [skill for skill in wanted if skill.casefold() in candidate_folded]
    missing = [skill for skill in wanted if skill.casefold() not in candidate_folded]

    by_category: dict[str, CategorySkills] = {}
    for skill in wanted:
        group = by_category.setdefault(skill_category(skill) or UNCATEGORIZED, CategorySkills())
        (group.matched if skill in matched else group.missing).append(skill)

    return SkillComparison(
        matched=matched,
        missing=missing,
        coverage=_coverage(len(matched), len(wanted)),
        byCategory=by_category,
    )


def match_resume_to_job(
    resume: ResumeMatchInput,
    job_requirements: JobRequirementsInput,
    resume_id: str = "",
    job_description_id: str = "",
    today: date | None = None,
) -> MatchingResult:
    candidate_skills = set(resume_skill_names(resume))

    required = compare_skills(job_requirements.requiredSkills, candidate_skills)
    # A skill listed as both required and preferred is only counted as required.
    required_names = {skill.casefold() for skill in required.matched + required.missing}
    preferred = compare_skills(
        [s for s in _canonical_list(job_requirements.preferredSkills) if s.casefold() not in required_names],
        candidate_skills,
    )

    return MatchingResult(
        resumeId=resume_id,
        jobDescriptionId=job_description_id,
        skills=SkillsMatch(required=required, preferred=preferred),
        experience=compare_experience(resume, job_requirements, candidate_skills, today),
        education=compare_education(resume, job_requirements),
        summary=MatchingSummary(
            requiredSkillCount=len(required.matched) + len(required.missing),
            matchedRequiredSkillCount=len(required.matched),
            missingRequiredSkillCount=len(required.missing),
            preferredSkillCount=len(preferred.matched) + len(preferred.missing),
            matchedPreferredSkillCount=len(preferred.matched),
            missingPreferredSkillCount=len(preferred.missing),
        ),
    )


def analyze_match(request: MatchingRequest, today: date | None = None) -> MatchingResult:
    return match_resume_to_job(
        request.resume,
        request.job_requirements,
        resume_id=request.resume_id,
        job_description_id=request.job_description_id,
        today=today,
    )
