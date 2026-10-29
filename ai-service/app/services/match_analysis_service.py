"""Rule-based analysis of existing match results (Step 7A).

Consumes the Step 6A comparison, the Step 6B score and the Step 6C semantic
similarity, and explains them: coverage levels, statuses, evidence-based
strengths and gaps, and what could not be evaluated. No matching is redone and
nothing is inferred beyond those results: every message is built from values
present in them. Levels describe measurements, never the candidate, and
nothing here predicts a hiring outcome.

Thresholds live in ``app/data/analysis_rules.py``.
"""

from app.data.analysis_rules import (
    COVERAGE_LEVELS,
    MAX_GAPS,
    MAX_INDIVIDUAL_SKILL_GAPS,
    MAX_STRENGTHS,
    PREFERRED_STRENGTH_MIN_COVERAGE,
    SIGNAL_DIFFERENCE_THRESHOLD,
    SIMILARITY_LEVELS,
    STRENGTH_SIMILARITY_LEVELS,
    level_for,
)
from app.models.matching import (
    AnalysisObservation,
    DataQualityAnalysis,
    EducationAnalysis,
    ExperienceAnalysis,
    ExperienceAreaAnalysis,
    GapObservation,
    MatchAnalysisResult,
    OverallAnalysis,
    ScoredMatchingResult,
    SemanticAnalysis,
    SemanticAspectAnalysis,
    SemanticErrorInput,
    SemanticMatchResult,
    SemanticSimilarityComponent,
    SignalComparison,
    SkillAnalysis,
    SkillComparison,
    SkillCoverageAnalysis,
    StrengthObservation,
)
from app.services.match_score_calculator import round_score

_LEVEL_WORDS = {"very_high": "very high", "high": "high", "moderate": "moderate", "low": "low", "very_low": "very low"}


def _years(value: float | None) -> str:
    return "unknown" if value is None else f"{value} {'year' if value == 1 else 'years'}"


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + f" and {items[-1]}"


# --- Category analyses ----------------------------------------------------


def analyze_skill_coverage(comparison: SkillComparison) -> SkillCoverageAnalysis:
    if comparison.coverage is None:
        return SkillCoverageAnalysis(status="not_applicable")
    return SkillCoverageAnalysis(
        status="calculated",
        matched=comparison.matched,
        missing=comparison.missing,
        coverage=comparison.coverage,
        coverageLevel=level_for(comparison.coverage, COVERAGE_LEVELS),
    )


def analyze_experience(matching: ScoredMatchingResult) -> ExperienceAnalysis:
    component = matching.components.experience
    areas = [
        ExperienceAreaAnalysis(
            area=area.area,
            requiredYears=area.requiredYears,
            evidenceYears=area.candidateYears,
            status={True: "satisfied", False: "skill_not_found", None: "insufficient_evidence"}[area.meetsRequirement],
            preferred=requirement.preferred,
        )
        for requirement in matching.experience.requirements
        for area in requirement.areas
    ]
    if component.status != "calculated":
        return ExperienceAnalysis(status=component.status, reason=component.reason, skillSpecific=areas)
    return ExperienceAnalysis(
        status="satisfied" if component.score == 100 else "below_requirement",
        requiredYears=matching.experience.requiredYears,
        candidateYears=matching.experience.candidateYears,
        score=component.score,
        skillSpecific=areas,
    )


def analyze_education(matching: ScoredMatchingResult) -> EducationAnalysis:
    component = matching.components.education
    if component.status == "not_applicable":
        return EducationAnalysis(status="not_applicable", reason=component.reason)

    required = [r for r in matching.education.requirements if not r.preferred]
    if component.status == "calculated" and component.score == 100:
        status, chosen = "satisfied", next(r for r in required if r.meetsRequirement is True)
    elif component.status == "calculated":
        status, chosen = "not_satisfied", required[0]
    else:
        status, chosen = "insufficient_data", next((r for r in required if r.meetsRequirement is None), required[0])
    return EducationAnalysis(
        status=status,
        requiredDegree=chosen.requirement,
        requiredFields=chosen.requiredFields,
        candidateDegree=chosen.candidateEducation,
        fieldMatch=chosen.fieldMatch,
        reason=component.reason,
    )


def _aspect(component: SemanticSimilarityComponent) -> SemanticAspectAnalysis:
    if component.status != "calculated" or component.similarity is None:
        return SemanticAspectAnalysis(status="not_available")
    return SemanticAspectAnalysis(
        similarity=component.similarity,
        level=level_for(component.similarity, SIMILARITY_LEVELS),
        status="calculated",
    )


def _signal_comparison(required: SkillCoverageAnalysis, skills: SemanticAspectAnalysis) -> SignalComparison | None:
    if required.coverage is None or skills.similarity is None:
        return None
    difference = round_score(skills.similarity - required.coverage)
    observation = None
    if difference >= SIGNAL_DIFFERENCE_THRESHOLD:
        observation = (
            "Semantic similarity is higher than exact skill coverage, indicating that some resume terminology may be "
            "related to the job requirements even when exact skill names were not detected. Missing skills remain "
            "missing unless they are identified by name."
        )
    elif difference <= -SIGNAL_DIFFERENCE_THRESHOLD:
        observation = (
            "Exact skill coverage is higher than semantic skill similarity: the skill names match, while the overall "
            "set of skills differs more in emphasis."
        )
    return SignalComparison(
        exactRequiredSkillCoverage=required.coverage,
        semanticSkillsSimilarity=skills.similarity,
        difference=difference,
        observation=observation,
    )


def analyze_semantic(
    semantic: SemanticMatchResult | None,
    error: SemanticErrorInput | None,
    required: SkillCoverageAnalysis,
) -> SemanticAnalysis:
    if semantic is None:
        return SemanticAnalysis(status="unavailable", reason=error.message if error else "Semantic similarity was not available.")
    skills = _aspect(semantic.skillsSemanticSimilarity)
    return SemanticAnalysis(
        status="calculated",
        overall=_aspect(semantic.overallSemanticSimilarity),
        experience=_aspect(semantic.experienceSemanticSimilarity),
        projects=_aspect(semantic.projectSemanticSimilarity),
        skills=skills,
        signalComparison=_signal_comparison(required, skills),
    )


# --- Strengths and gaps ---------------------------------------------------


def build_strengths(
    skills: SkillAnalysis, experience: ExperienceAnalysis, education: EducationAnalysis, semantic: SemanticAnalysis
) -> list[StrengthObservation]:
    """Strengths in priority order; each needs positive evidence in the results."""
    strengths: list[StrengthObservation] = []
    required, preferred = skills.required, skills.preferred
    total = len(required.matched) + len(required.missing)

    if required.coverageLevel == "complete":
        strengths.append(StrengthObservation(category="skills", message=f"All {total} required skills were identified in the resume."))
    elif required.coverageLevel == "strong":
        strengths.append(
            StrengthObservation(
                category="skills",
                message=f"Most required skills were identified in the resume ({len(required.matched)} of {total}).",
            )
        )

    if experience.status == "satisfied":
        strengths.append(
            StrengthObservation(
                category="experience",
                message=f"Available experience ({_years(experience.candidateYears)}) meets the explicit requirement of "
                f"{_years(experience.requiredYears)}.",
            )
        )
    for area in experience.skillSpecific:
        if area.status == "satisfied" and not area.preferred:
            strengths.append(
                StrengthObservation(
                    category="experience",
                    message=f"Dated work experience mentioning {area.area} covers at least {_years(area.evidenceYears)}, "
                    f"meeting the requirement of {_years(area.requiredYears)}.",
                )
            )

    if education.status == "satisfied":
        strengths.append(
            StrengthObservation(
                category="education",
                message=f"The education requirement ({education.requiredDegree}) is met by the degree identified in the "
                f"resume ({education.candidateDegree}).",
            )
        )

    if preferred.coverage is not None and preferred.coverage >= PREFERRED_STRENGTH_MIN_COVERAGE and preferred.matched:
        count = len(preferred.matched) + len(preferred.missing)
        strengths.append(
            StrengthObservation(
                category="skills",
                message=f"{len(preferred.matched)} of {count} preferred skills were identified: {_join(preferred.matched)}.",
            )
        )

    if semantic.experience and semantic.experience.level in STRENGTH_SIMILARITY_LEVELS:
        strengths.append(
            StrengthObservation(
                category="semantic_similarity",
                message=f"Resume experience has {_LEVEL_WORDS[semantic.experience.level]} semantic similarity with the job "
                "responsibilities and experience requirements.",
            )
        )
    if semantic.projects and semantic.projects.level in STRENGTH_SIMILARITY_LEVELS:
        strengths.append(
            StrengthObservation(
                category="projects",
                message=f"Resume projects have {_LEVEL_WORDS[semantic.projects.level]} semantic similarity with the job "
                "responsibilities and required skills.",
            )
        )
    return strengths[:MAX_STRENGTHS]


def build_gaps(
    skills: SkillAnalysis, experience: ExperienceAnalysis, education: EducationAnalysis
) -> tuple[list[GapObservation], int]:
    """Gaps in priority order, capped at MAX_GAPS; returns (gaps, number left out)."""
    gaps: list[GapObservation] = []
    missing = skills.required.missing
    if len(missing) <= MAX_INDIVIDUAL_SKILL_GAPS:
        gaps += [
            GapObservation(category="required_skill", message=f"{skill} is listed as a required skill but was not detected in the resume.")
            for skill in missing
        ]
    else:
        gaps.append(
            GapObservation(
                category="required_skill",
                message=f"{len(missing)} required skills were not detected in the resume: {_join(missing)}.",
            )
        )

    if experience.status == "below_requirement":
        gaps.append(
            GapObservation(
                category="experience",
                message=f"Available experience ({_years(experience.candidateYears)}) is below the explicit requirement of "
                f"{_years(experience.requiredYears)}.",
            )
        )
    for area in experience.skillSpecific:
        if area.status == "skill_not_found" and not area.preferred:
            gaps.append(
                GapObservation(
                    category="experience",
                    message=f"The job asks for {_years(area.requiredYears)} of {area.area} experience, but {area.area} "
                    "was not detected in the resume.",
                )
            )

    if education.status == "not_satisfied":
        found = f" ({education.candidateDegree})" if education.candidateDegree else ""
        gaps.append(
            GapObservation(
                category="education",
                message=f"The education requirement ({education.requiredDegree}) is not met by the degree identified in "
                f"the resume{found}.",
            )
        )

    if skills.preferred.missing:
        gaps.append(
            GapObservation(category="preferred_skill", message=f"Preferred skills not detected: {_join(skills.preferred.missing)}.")
        )

    # Could-not-evaluate items come last and are worded neutrally: they are not shortcomings.
    if experience.status == "insufficient_data":
        gaps.append(GapObservation(category="insufficient_data", message=f"Experience could not be evaluated: {experience.reason}."))
    if education.status == "insufficient_data":
        gaps.append(GapObservation(category="insufficient_data", message=f"Education could not be evaluated: {education.reason}."))

    return gaps[:MAX_GAPS], max(len(gaps) - MAX_GAPS, 0)


# --- Data quality and overall ---------------------------------------------


def assess_data_quality(
    skills: SkillAnalysis, experience: ExperienceAnalysis, education: EducationAnalysis, semantic: SemanticAnalysis
) -> DataQualityAnalysis:
    issues: list[str] = []
    not_applicable: list[str] = []
    evaluated = 0

    for label, analysis in (("required skills", skills.required), ("preferred skills", skills.preferred)):
        if analysis.status == "not_applicable":
            not_applicable.append(f"The job lists no {label}.")
        else:
            evaluated += 1

    for label, analysis in (("Experience", experience), ("Education", education)):
        if analysis.status == "not_applicable":
            not_applicable.append(f"{analysis.reason}.")
        elif analysis.status == "insufficient_data":
            issues.append(f"{label} could not be evaluated: {analysis.reason}.")
        else:
            evaluated += 1

    if semantic.status == "unavailable":
        issues.append(f"Semantic similarity could not be calculated: {semantic.reason}")
    else:
        evaluated += 1

    if evaluated == 0:
        status = "insufficient"
    elif not issues:
        status = "complete"
    elif len(issues) == 1:
        status = "mostly_complete"
    else:
        status = "partial"
    return DataQualityAnalysis(status=status, issues=issues, notApplicable=not_applicable)


_COVERAGE_HIGHLIGHTS = {
    "complete": "All required skills were identified.",
    "strong": "Most required skills were identified.",
    "partial": "Some required skills were identified; several were not detected.",
    "limited": "Few of the required skills were identified.",
    "none": "None of the required skills were identified.",
}


def build_overall(
    matching: ScoredMatchingResult,
    skills: SkillAnalysis,
    experience: ExperienceAnalysis,
    education: EducationAnalysis,
    semantic: SemanticAnalysis,
) -> OverallAnalysis:
    highlights: list[AnalysisObservation] = []
    parts: list[str] = []
    required, preferred = skills.required, skills.preferred

    if required.coverageLevel:
        total = len(required.matched) + len(required.missing)
        parts.append(f"{len(required.matched)} of {total} required skills were identified ({required.coverageLevel} coverage)")
        highlights.append(AnalysisObservation(category="required_skills", message=_COVERAGE_HIGHLIGHTS[required.coverageLevel]))
    if preferred.status == "calculated":
        total = len(preferred.matched) + len(preferred.missing)
        highlights.append(
            AnalysisObservation(category="preferred_skills", message=f"{len(preferred.matched)} of {total} preferred skills were identified.")
        )

    experience_messages = {
        "satisfied": ("the explicit experience requirement is met", "Available experience meets the explicit requirement."),
        "below_requirement": ("available experience is below the explicit requirement", "Available experience is below the explicit requirement."),
        "insufficient_data": (None, "Experience could not be compared reliably."),
    }
    if experience.status in experience_messages:
        summary_part, highlight = experience_messages[experience.status]
        if summary_part:
            parts.append(summary_part)
        highlights.append(AnalysisObservation(category="experience", message=highlight))

    education_messages = {
        "satisfied": ("the education requirement is met", "The education requirement is met according to the resume."),
        "not_satisfied": ("the education requirement is not met", "The education requirement is not met according to the resume."),
        "insufficient_data": (None, "Education could not be compared reliably."),
    }
    if education.status in education_messages:
        summary_part, highlight = education_messages[education.status]
        if summary_part:
            parts.append(summary_part)
        highlights.append(AnalysisObservation(category="education", message=highlight))

    if semantic.experience and semantic.experience.level:
        highlights.append(
            AnalysisObservation(
                category="semantic_similarity",
                message=f"Resume experience has {_LEVEL_WORDS[semantic.experience.level]} semantic similarity with the job responsibilities.",
            )
        )
    elif semantic.overall and semantic.overall.level:
        highlights.append(
            AnalysisObservation(
                category="semantic_similarity",
                message=f"The resume has {_LEVEL_WORDS[semantic.overall.level]} semantic similarity with the job description.",
            )
        )

    score_available = matching.overallScore is not None
    if not score_available:
        summary = "Not enough comparable information was available to calculate a match score."
    elif parts:
        text = "; ".join(parts)
        summary = text[0].upper() + text[1:] + "."
    else:
        total = len(preferred.matched) + len(preferred.missing)
        summary = f"{len(preferred.matched)} of {total} preferred skills were identified."
    return OverallAnalysis(matchScore=matching.overallScore, scoreAvailable=score_available, summary=summary, highlights=highlights)


def analyze_match_results(
    matching: ScoredMatchingResult,
    semantic: SemanticMatchResult | None = None,
    semantic_error: SemanticErrorInput | None = None,
) -> MatchAnalysisResult:
    """Explain Step 6A/6B/6C results without recomputing them."""
    skills = SkillAnalysis(
        required=analyze_skill_coverage(matching.skills.required),
        preferred=analyze_skill_coverage(matching.skills.preferred),
    )
    experience = analyze_experience(matching)
    education = analyze_education(matching)
    semantic_analysis = analyze_semantic(semantic, semantic_error, skills.required)
    gaps, additional = build_gaps(skills, experience, education)
    return MatchAnalysisResult(
        overall=build_overall(matching, skills, experience, education, semantic_analysis),
        skills=skills,
        experience=experience,
        education=education,
        semanticSimilarity=semantic_analysis,
        dataQuality=assess_data_quality(skills, experience, education, semantic_analysis),
        strengths=build_strengths(skills, experience, education, semantic_analysis),
        gaps=gaps,
        additionalGapCount=additional,
    )
