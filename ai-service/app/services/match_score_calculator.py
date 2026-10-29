"""Turn Step 6A's factual comparison into a transparent 0-100 match score.

Each component is scored 0-100 from the comparison data:

* required/preferred skills: the coverage percentage Step 6A calculated;
* experience: candidate years / required years, capped at 100;
* education: 100 if the degree requirement is met, 0 if not.

A component the job does not specify is "not_applicable"; one that cannot be
judged from the resume is "insufficient_data". Neither counts: the overall
score is the weighted average over the components that were calculated,

    overall = sum(score_i * weight_i) / sum(weight_i)   (calculated i only)

so a missing requirement neither helps nor penalises the candidate. With no
calculable component there is no score (None), never 0.
"""

from dataclasses import dataclass

from app.data.matching_weights import (
    MATCHING_WEIGHTS,
    SCORE_VERSION,
    SCORING_METHOD,
    ComponentName,
    MatchingWeights,
    validate_weights,
)
from app.models.matching import (
    EducationMatch,
    ExperienceMatch,
    MatchingResult,
    MatchScoreComponent,
    MatchScoreComponents,
    MatchScoreMetadata,
    MatchScoreResult,
    MatchScoreWeights,
    ScoredMatchingResult,
    SkillComparison,
)

COMPONENTS: tuple[ComponentName, ...] = ("requiredSkills", "preferredSkills", "experience", "education")


@dataclass(frozen=True)
class ComponentScore:
    score: float | None
    status: str
    reason: str | None = None


def round_score(value: float) -> int | float:
    """Two decimals; whole numbers stay ints so 100 serialises as 100, not 100.0."""
    rounded = round(value + 0.0, 2)
    return int(rounded) if rounded.is_integer() else rounded


def score_skills(comparison: SkillComparison, kind: str) -> ComponentScore:
    if comparison.coverage is None:
        return ComponentScore(None, "not_applicable", f"The job lists no {kind} skills")
    # Recomputed from the counts rather than Step 6A's rounded coverage.
    total = len(comparison.matched) + len(comparison.missing)
    return ComponentScore(len(comparison.matched) / total * 100, "calculated")


def score_experience(experience: ExperienceMatch) -> ComponentScore:
    if experience.status == "not_applicable":
        return ComponentScore(None, "not_applicable", "The job states no years of experience")
    if experience.requiredYears is None:
        if all(requirement.preferred for requirement in experience.requirements):
            return ComponentScore(None, "not_applicable", "The job's experience requirements are only preferred")
        # Only skill-specific requirements ("3+ years of React"); total experience cannot answer them.
        return ComponentScore(
            None, "insufficient_data", "The job only states skill-specific experience, which cannot be measured reliably"
        )
    if experience.candidateYears is None:
        return ComponentScore(
            None, "insufficient_data", experience.candidateYearsReason or "Resume experience could not be calculated"
        )
    if experience.requiredYears == 0:
        return ComponentScore(100, "calculated")
    return ComponentScore(min(experience.candidateYears / experience.requiredYears * 100, 100), "calculated")


def score_education(education: EducationMatch) -> ComponentScore:
    if education.status == "not_applicable":
        return ComponentScore(None, "not_applicable", "The job states no education requirement")
    required = [r for r in education.requirements if not r.preferred]
    if not required:
        return ComponentScore(None, "not_applicable", "The job's education requirements are only preferred")
    outcomes = [r.meetsRequirement for r in required]
    # Separately listed degrees are alternatives: meeting any one is enough.
    if True in outcomes:
        return ComponentScore(100, "calculated")
    if all(outcome is False for outcome in outcomes):
        return ComponentScore(0, "calculated")
    return ComponentScore(None, "insufficient_data", "The resume's education could not be compared with the requirement")


def component_scores(matching: MatchingResult) -> dict[ComponentName, ComponentScore]:
    return {
        "requiredSkills": score_skills(matching.skills.required, "required"),
        "preferredSkills": score_skills(matching.skills.preferred, "preferred"),
        "experience": score_experience(matching.experience),
        "education": score_education(matching.education),
    }


def combine(scores: dict[ComponentName, ComponentScore], weights: MatchingWeights = MATCHING_WEIGHTS) -> MatchScoreResult:
    validate_weights(weights)
    applicable_weight = sum(weights[name] for name in COMPONENTS if scores[name].status == "calculated")

    components = {}
    weighted_total = 0.0
    for name in COMPONENTS:
        component = scores[name]
        weight = weights[name]
        if component.status != "calculated" or applicable_weight == 0:
            components[name] = MatchScoreComponent(
                weight=round_score(weight * 100), status=component.status, reason=component.reason
            )
            continue
        effective = weight / applicable_weight
        weighted_total += component.score * effective
        components[name] = MatchScoreComponent(
            score=round_score(component.score),
            weight=round_score(weight * 100),
            effectiveWeight=round_score(effective * 100),
            contribution=round_score(component.score * effective),
            status="calculated",
        )

    calculated = applicable_weight > 0
    return MatchScoreResult(
        overallScore=round_score(weighted_total) if calculated else None,
        scoreStatus="calculated" if calculated else "insufficient_data",
        components=MatchScoreComponents(**components),
        scoreMetadata=MatchScoreMetadata(
            scoringMethod=SCORING_METHOD,
            version=SCORE_VERSION,
            weights=MatchScoreWeights(**{name: round_score(weights[name] * 100) for name in COMPONENTS}),
        ),
    )


def calculate_match_score(matching: MatchingResult, weights: MatchingWeights = MATCHING_WEIGHTS) -> MatchScoreResult:
    """Score a Step 6A matching result."""
    return combine(component_scores(matching), weights)


def score_matching_result(matching: MatchingResult, weights: MatchingWeights = MATCHING_WEIGHTS) -> ScoredMatchingResult:
    """Step 6A's comparison with the score added; the comparison itself is unchanged."""
    return ScoredMatchingResult(**matching.model_dump(), **calculate_match_score(matching, weights).model_dump())
