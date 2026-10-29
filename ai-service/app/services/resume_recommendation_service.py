"""Deterministic resume improvement recommendations (Step 7B).

Built only from results that already exist: the Step 6A comparison and 6B score
(``ScoredMatchingResult``), the Step 7A analysis (which carries 6C semantic
similarity), and the structured resume's roles and projects (Step 4D).

Rules followed throughout:

* Skills are reported as "not detected", never as absent: the parser may have
  missed them. Every skill action separates documenting real experience from
  learning the skill, and never suggests listing something the user lacks.
* Semantic similarity never counts as evidence that an exact skill is present.
* Nothing is invented: messages only name skills, requirements, roles and
  projects that appear in the inputs, and never add metrics, results or duties.
* A requirement the job does not state produces no recommendation; a limitation
  of the job description or the service is reported under ``limitations``.

Recommendations are ordered by priority, then by rule (missing required skills,
explicit experience/education gaps, unclear existing evidence, preferred skills,
other content), de-duplicated and capped at MAX_RECOMMENDATIONS.
"""

from dataclasses import dataclass, field
from datetime import date

from app.data.analysis_rules import SIGNAL_DIFFERENCE_THRESHOLD
from app.data.recommendation_rules import (
    BRIEF_PROJECT_DESCRIPTION_WORDS,
    MAX_INDIVIDUAL_SKILL_RECOMMENDATIONS,
    MAX_PROJECT_RECOMMENDATIONS,
    MAX_RECOMMENDATIONS,
    PRIORITY_RANK,
)
from app.models.matching import (
    MatchAnalysisResult,
    RecommendationExperienceInput,
    RecommendationResumeInput,
    ResumeExperienceInput,
    ResumeRecommendation,
    ResumeRecommendations,
    ScoredMatchingResult,
)
from app.services.experience_matcher import date_issue
from app.services.skill_extractor import extract_skills_in_order

NO_RECOMMENDATIONS_MESSAGE = "No specific recommendation could be reliably generated from the available information."

# Rule groups, in the order recommendations of equal priority are listed.
REQUIRED_SKILLS, EXPLICIT_GAPS, UNCLEAR_EVIDENCE, PREFERRED_SKILLS, OTHER_CONTENT = range(5)


@dataclass
class _Candidate:
    category: str
    priority: str
    group: int
    title: str
    issue: str
    reason: str
    action: str
    related: list[str] = field(default_factory=list)
    evidence: str | None = None
    # Two candidates with the same key are about the same thing; only the first is kept.
    key: tuple = ()


def _years(value: float | None) -> str:
    return f"{value} {'year' if value == 1 else 'years'}"


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}"


def _role_label(role: RecommendationExperienceInput) -> str:
    return " at ".join(part for part in (role.title, role.company) if part) or "an untitled role"


def _project_label(name: str | None) -> str:
    return f"the '{name}' project" if name else "a project entry"


def _skill_action(skill_text: str, plural: bool = False) -> str:
    them = "them" if plural else "it"
    return (
        f"If you have used {skill_text}, describe where and how you used {them} in the relevant work or project entry "
        f"so {them} can be identified. If you have not, consider learning {them} before listing {them} as a skill."
    )


# --- Rules ----------------------------------------------------------------


def _required_skill_candidates(analysis: MatchAnalysisResult) -> list[_Candidate]:
    missing = analysis.skills.required.missing
    if len(missing) <= MAX_INDIVIDUAL_SKILL_RECOMMENDATIONS:
        individual, grouped = missing, []
    else:
        individual, grouped = missing[: MAX_INDIVIDUAL_SKILL_RECOMMENDATIONS - 1], missing[MAX_INDIVIDUAL_SKILL_RECOMMENDATIONS - 1 :]

    candidates = [
        _Candidate(
            category="required_skill",
            priority="high",
            group=REQUIRED_SKILLS,
            title=f"Review the {skill} requirement",
            issue=f"{skill} was not detected in the resume.",
            reason=f"{skill} is listed as a required skill for this position.",
            action=_skill_action(skill),
            related=[skill],
            evidence=f"Job requirements list {skill} as required; the resume parser did not detect it.",
            key=("skill", skill),
        )
        for skill in individual
    ]
    if grouped:
        candidates.append(
            _Candidate(
                category="required_skill",
                priority="high",
                group=REQUIRED_SKILLS,
                title=f"Review {len(grouped)} more required skills",
                issue=f"{_join(grouped)} were not detected in the resume.",
                reason="These are listed as required skills for this position.",
                action=_skill_action(_join(grouped), plural=True),
                related=grouped,
                evidence="Job requirements list these skills as required; the resume parser did not detect them.",
                key=("skill-group",),
            )
        )
    return candidates


def _experience_candidates(
    matching: ScoredMatchingResult, analysis: MatchAnalysisResult, resume: RecommendationResumeInput, today: date
) -> tuple[list[_Candidate], list[str]]:
    candidates: list[_Candidate] = []
    limitations: list[str] = []
    experience = analysis.experience
    missing_required = set(analysis.skills.required.missing)

    if experience.status == "below_requirement":
        candidates.append(
            _Candidate(
                category="experience",
                priority="high",
                group=EXPLICIT_GAPS,
                title="Check that your relevant experience is fully represented",
                issue=f"The job specifies {_years(experience.requiredYears)} of experience; the dates in the resume add up "
                f"to {_years(experience.candidateYears)}.",
                reason="The job states an explicit minimum amount of experience.",
                action="Review your experience dates and descriptions to make sure every relevant role you have held is "
                "included with accurate dates. Do not change dates or add roles you did not hold.",
                evidence=f"Required: {_years(experience.requiredYears)}; calculated from resume dates: "
                f"{_years(experience.candidateYears)}.",
                key=("experience-years",),
            )
        )
    elif experience.status == "insufficient_data":
        if matching.experience.requiredYears is None:
            # Only skill-specific requirements: a limitation of the method, not of the resume.
            limitations.append(
                "The job states experience only for specific skills, which cannot be measured reliably from resume dates."
            )
        elif matching.experience.candidateYearsReason == "The resume lists no work experience":
            candidates.append(
                _Candidate(
                    category="data_quality",
                    priority="low",
                    group=OTHER_CONTENT,
                    title="Check that your work experience can be detected",
                    issue="No work experience entries were detected in the resume.",
                    reason=f"The job states an explicit requirement of {_years(matching.experience.requiredYears)} of experience.",
                    action="If you have relevant work experience, make sure it appears under a clear heading such as "
                    "'Experience', with the role, organisation and dates. Do not add roles you have not held.",
                    key=("experience-missing",),
                )
            )
        else:
            affected = [
                _role_label(role)
                for role in resume.experience
                if date_issue(ResumeExperienceInput(startDate=role.startDate, endDate=role.endDate, isCurrent=role.isCurrent), today)
            ]
            evidence = f"Affected entries: {_join(affected[:3])}." if affected else None
            candidates.append(
                _Candidate(
                    category="data_quality",
                    priority="medium",
                    group=UNCLEAR_EVIDENCE,
                    title="Complete the dates of your roles",
                    issue=f"Experience could not be compared with the job's requirement of "
                    f"{_years(matching.experience.requiredYears)}: {experience.reason.lower() if experience.reason else 'some dates are incomplete'}.",
                    reason="Total experience is only calculated from month-precise start and end dates; it is never estimated.",
                    action="If you know them, add the start and end month to each role (for example 'Jan 2022 – Mar 2024'), "
                    "and mark roles you still hold as 'Present'. Do not guess dates you are unsure of.",
                    evidence=evidence,
                    key=("experience-dates",),
                )
            )

    for area in experience.skillSpecific:
        if area.preferred:
            continue
        if area.status == "skill_not_found" and area.area not in missing_required:
            candidates.append(
                _Candidate(
                    category="experience",
                    priority="high",
                    group=EXPLICIT_GAPS,
                    title=f"Review the {area.area} experience requirement",
                    issue=f"{area.area} was not detected in the resume.",
                    reason=f"The job asks for {_years(area.requiredYears)} of {area.area} experience.",
                    action=_skill_action(area.area),
                    related=[area.area],
                    evidence=f"Job requirement: {_years(area.requiredYears)} of {area.area}.",
                    key=("skill", area.area),
                )
            )
        elif area.status == "insufficient_evidence":
            candidates.append(
                _Candidate(
                    category="resume_content",
                    priority="medium",
                    group=UNCLEAR_EVIDENCE,
                    title=f"Show where you used {area.area}",
                    issue=(
                        f"{area.area} appears in the resume, but no role with complete dates mentions it."
                        if area.evidenceYears is None
                        else f"{area.area} appears in the resume, and dated roles that mention it cover "
                        f"{_years(area.evidenceYears)}, less than the {_years(area.requiredYears)} the job asks for."
                    ),
                    reason=f"The job asks for {_years(area.requiredYears)} of {area.area} experience.",
                    action=f"If accurate, mention {area.area} in the descriptions of each role where you used it, with "
                    "complete dates. Only include roles where you actually used it.",
                    related=[area.area],
                    evidence=f"Dated roles mentioning {area.area}: "
                    f"{'none' if area.evidenceYears is None else _years(area.evidenceYears)}.",
                    key=("area", area.area),
                )
            )
    return candidates, limitations


def _education_candidates(matching: ScoredMatchingResult, analysis: MatchAnalysisResult) -> tuple[list[_Candidate], list[str]]:
    education = analysis.education
    if education.status == "not_satisfied":
        found = f" ({education.candidateDegree})" if education.candidateDegree else ""
        return [
            _Candidate(
                category="education",
                priority="high",
                group=EXPLICIT_GAPS,
                title="Check how your qualifications are listed",
                issue=f"The degree identified in the resume{found} does not meet the stated requirement "
                f"({education.requiredDegree}).",
                reason="The job states an explicit education requirement.",
                action="Check that every qualification you have completed is listed with its full degree name. "
                "Do not list qualifications you have not completed.",
                evidence=f"Job requirement: {education.requiredDegree}.",
                key=("education",),
            )
        ], []

    if education.status == "insufficient_data":
        required = [r for r in matching.education.requirements if not r.preferred]
        requirement = next((r for r in required if r.meetsRequirement is None), required[0] if required else None)
        if requirement is None or requirement.requiredLevel is None:
            return [], ["The job's education requirement does not name a degree level that can be compared automatically."]
        if requirement.candidateEducation is None:
            return [
                _Candidate(
                    category="data_quality",
                    priority="medium",
                    group=UNCLEAR_EVIDENCE,
                    title="Check that your education can be detected",
                    issue="No degree was detected in the resume, so the education requirement could not be checked.",
                    reason=f"The job states an education requirement ({requirement.requirement}).",
                    action="If you hold a relevant qualification, list it under an 'Education' heading with the full "
                    "degree name. Do not list qualifications you have not completed.",
                    evidence=f"Job requirement: {requirement.requirement}.",
                    key=("education",),
                )
            ], []
        return [], [
            f"The degree in the resume ({requirement.candidateEducation}) could not be compared automatically with "
            f"the requirement ({requirement.requirement})."
        ]
    return [], []


def _project_candidates(matching: ScoredMatchingResult, resume: RecommendationResumeInput) -> list[_Candidate]:
    job_skills = [
        *matching.skills.required.matched,
        *matching.skills.required.missing,
        *matching.skills.preferred.matched,
        *matching.skills.preferred.missing,
    ]
    candidates: list[_Candidate] = []
    for index, project in enumerate(resume.projects):
        relevant = [skill for skill in dict.fromkeys(job_skills) if skill in set(project.technologies)]
        if not relevant:
            continue
        label = _project_label(project.name)
        description = " ".join(project.description)
        words = len(description.split())
        skills = _join(relevant)
        common = dict(
            category="projects",
            priority="medium",
            group=UNCLEAR_EVIDENCE,
            related=relevant,
            reason=f"{skills} {'is' if len(relevant) == 1 else 'are'} relevant to this job's requirements.",
            evidence=f"Resume: {label}.",
            key=("project", index),
        )
        if words == 0:
            candidates.append(
                _Candidate(
                    title=f"Describe {label}",
                    issue=f"{label[0].upper() + label[1:]} names {skills} but has no description of the work.",
                    action=f"If accurate, add a short description of your role, the functionality you implemented and how "
                    f"you used {skills}.",
                    **common,
                )
            )
        elif words < BRIEF_PROJECT_DESCRIPTION_WORDS:
            candidates.append(
                _Candidate(
                    title=f"Expand the description of {label}",
                    issue=f"The description of {label} is brief ({words} words), so your contribution is hard to identify.",
                    action=f"If accurate, expand the description to explain your role, the technologies you used ({skills}) "
                    "and the functionality you implemented.",
                    **common,
                )
            )
        else:
            described = set(extract_skills_in_order(description))
            unexplained = [skill for skill in relevant if skill not in described]
            if unexplained:
                skills = _join(unexplained)
                candidates.append(
                    _Candidate(
                        **{**common, "related": unexplained},
                        title=f"Explain how {label} used {skills}",
                        issue=f"{skills} {'is' if len(unexplained) == 1 else 'are'} listed for {label}, but the description "
                        f"does not say how {'it was' if len(unexplained) == 1 else 'they were'} used.",
                        action=f"If accurate, explain in the description how you used {skills} in this project.",
                    )
                )
        if len(candidates) == MAX_PROJECT_RECOMMENDATIONS:
            break
    return candidates


def _terminology_candidate(analysis: MatchAnalysisResult) -> list[_Candidate]:
    comparison = analysis.semanticSimilarity.signalComparison
    missing = analysis.skills.required.missing
    if comparison is None or comparison.difference < SIGNAL_DIFFERENCE_THRESHOLD or not missing:
        return []
    return [
        _Candidate(
            category="resume_content",
            priority="medium",
            group=UNCLEAR_EVIDENCE,
            title="Use standard names for skills you have used",
            issue=f"Semantic similarity between the resume's skills and the job's skills "
            f"({comparison.semanticSkillsSimilarity}%) is higher than exact required-skill coverage "
            f"({comparison.exactRequiredSkillCoverage}%).",
            reason="Related experience may be described without the exact skill names, so it could not be matched. "
            "Semantic similarity alone does not show that the missing skills are present.",
            action="Where accurate, refer to tools and technologies you actually used by their standard names, as written "
            "in the job requirements. Do not add names of tools you have not used.",
            related=missing,
            evidence="Step 6C skill similarity compared with Step 6A exact skill coverage.",
            key=("terminology",),
        )
    ]


def _preferred_candidate(analysis: MatchAnalysisResult) -> list[_Candidate]:
    preferred = analysis.skills.preferred
    if preferred.status != "calculated" or not preferred.missing:
        return []
    total = len(preferred.matched) + len(preferred.missing)
    plural = len(preferred.missing) > 1
    return [
        _Candidate(
            category="preferred_skill",
            # More relevant when most of the preferred list was not detected.
            priority="medium" if len(preferred.missing) * 2 >= total else "low",
            group=PREFERRED_SKILLS,
            title=f"Review the preferred skill{'s' if plural else ''}: {_join(preferred.missing)}",
            issue=f"{_join(preferred.missing)} {'were' if plural else 'was'} not detected in the resume "
            f"({len(preferred.matched)} of {total} preferred skills were detected).",
            reason="Preferred skills are not required, but they can improve alignment with this job.",
            action=f"If you have used {'any of these' if plural else 'it'}, make that experience visible in the relevant "
            f"project or work entry. Otherwise, consider learning the relevant concepts before listing "
            f"{'them' if plural else 'it'}.",
            related=preferred.missing,
            evidence="Job requirements list these as preferred, not required." if plural else "Job requirements list this as preferred, not required.",
            key=("preferred",),
        )
    ]


def _content_candidates(matching: ScoredMatchingResult, resume: RecommendationResumeInput) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    entries_text = " ".join(
        [" ".join(role.description) for role in resume.experience]
        + [" ".join([*project.description, *project.technologies]) for project in resume.projects]
    )
    if resume.experience or resume.projects:
        demonstrated = set(extract_skills_in_order(entries_text))
        listed_only = [skill for skill in matching.skills.required.matched if skill not in demonstrated]
        if listed_only:
            plural = len(listed_only) > 1
            candidates.append(
                _Candidate(
                    category="resume_content",
                    priority="low",
                    group=OTHER_CONTENT,
                    title="Show where you used your listed required skills",
                    issue=f"{_join(listed_only)} {'appear' if plural else 'appears'} in the resume, but not in any role "
                    "or project description.",
                    reason="These are required skills for this job; describing where they were used makes them easier to verify.",
                    action=f"If accurate, mention {_join(listed_only)} in the roles or projects where you used "
                    f"{'them' if plural else 'it'}.",
                    related=listed_only,
                    evidence="Detected in the resume, not in role or project descriptions.",
                    key=("listed-only",),
                )
            )

    undescribed = [_role_label(role) for role in resume.experience if (role.title or role.company) and not role.description]
    if undescribed and matching.skills.required.coverage is not None:
        plural = len(undescribed) > 1
        candidates.append(
            _Candidate(
                category="resume_content",
                priority="low",
                group=OTHER_CONTENT,
                title=f"Describe your responsibilities in {'these roles' if plural else 'this role'}",
                issue=f"{_join(undescribed[:3])} {'have' if plural else 'has'} no description of responsibilities.",
                reason="Role descriptions are where relevant skills and experience can be identified for this job.",
                action="If accurate, add a few lines describing what you did in each role and the tools you used.",
                evidence=f"Resume: {_join(undescribed[:3])}.",
                key=("undescribed-roles",),
            )
        )
    return candidates


def _limitations(analysis: MatchAnalysisResult) -> list[str]:
    if analysis.semanticSimilarity.status != "unavailable":
        return []
    text = "Semantic similarity was not available, so it was not used."
    reason = analysis.semanticSimilarity.reason
    if reason and "not available" not in reason:
        text += f" Reason: {reason}"
    return [text]


# --- Assembly -------------------------------------------------------------


def build_recommendations(
    matching: ScoredMatchingResult,
    analysis: MatchAnalysisResult,
    resume: RecommendationResumeInput | None = None,
    today: date | None = None,
) -> ResumeRecommendations:
    """Prioritised, de-duplicated recommendations for this resume and job."""
    resume = resume or RecommendationResumeInput()
    today = today or date.today()

    experience_candidates, experience_limits = _experience_candidates(matching, analysis, resume, today)
    education_candidates, education_limits = _education_candidates(matching, analysis)
    candidates = [
        *_required_skill_candidates(analysis),
        *experience_candidates,
        *education_candidates,
        *_project_candidates(matching, resume),
        *_terminology_candidate(analysis),
        *_preferred_candidate(analysis),
        *_content_candidates(matching, resume),
    ]

    # Stable sort: priority, then rule group, then the order rules produced them.
    candidates.sort(key=lambda c: (PRIORITY_RANK[c.priority], c.group))
    seen_keys: set[tuple] = set()
    seen_titles: set[str] = set()
    unique: list[_Candidate] = []
    for candidate in candidates:
        if candidate.key in seen_keys or candidate.title in seen_titles:
            continue
        seen_keys.add(candidate.key)
        seen_titles.add(candidate.title)
        unique.append(candidate)

    items = [
        ResumeRecommendation(
            id=f"rec-{index:03d}",
            category=c.category,
            priority=c.priority,
            title=c.title,
            issue=c.issue,
            reason=c.reason,
            action=c.action,
            relatedSkills=c.related,
            evidence=c.evidence,
        )
        for index, c in enumerate(unique[:MAX_RECOMMENDATIONS], start=1)
    ]
    return ResumeRecommendations(
        items=items,
        total=len(items),
        limitations=[*experience_limits, *education_limits, *_limitations(analysis)],
        message=None if items else NO_RECOMMENDATIONS_MESSAGE,
    )
