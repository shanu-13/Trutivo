from datetime import date

import pytest

from app.data.matching_weights import MATCHING_WEIGHTS, validate_weights
from app.models.matching import EducationMatch, ExperienceMatch, SkillComparison
from app.services.match_score_calculator import (
    ComponentScore,
    calculate_match_score,
    combine,
    round_score,
    score_education,
    score_experience,
    score_skills,
)
from app.services.resume_job_matcher import match_resume_to_job
from tests.test_matching import job, resume

NA = ComponentScore(None, "not_applicable", "n/a")
UNKNOWN = ComponentScore(None, "insufficient_data", "unknown")


def calc(value: float) -> ComponentScore:
    return ComponentScore(value, "calculated")


def scores(required=NA, preferred=NA, experience=NA, education=NA):
    return {"requiredSkills": required, "preferredSkills": preferred, "experience": experience, "education": education}


# --- Required tests from the spec -----------------------------------------


def test_1_all_components_perfect():
    assert combine(scores(calc(100), calc(100), calc(100), calc(100))).overallScore == 100


def test_2_weighted_example():
    result = combine(scores(calc(80), calc(75), calc(100), calc(100)))
    assert result.overallScore == 84.25
    c = result.components
    assert (c.requiredSkills.contribution, c.preferredSkills.contribution, c.experience.contribution, c.education.contribution) == (
        48,
        11.25,
        15,
        10,
    )


def test_3_no_preferred_skills_excluded_and_normalised():
    result = combine(scores(calc(80), NA, calc(100), calc(100)))
    # (80*60 + 100*15 + 100*10) / 85
    assert result.overallScore == round((80 * 60 + 100 * 15 + 100 * 10) / 85, 2) == 85.88
    assert result.components.preferredSkills.model_dump() == {
        "score": None,
        "weight": 15,
        "effectiveWeight": None,
        "contribution": None,
        "status": "not_applicable",
        "reason": "n/a",
    }
    assert result.components.requiredSkills.effectiveWeight == 70.59


def test_4_no_education_requirement_excluded():
    result = combine(scores(calc(80), calc(75), calc(100), NA))
    assert result.overallScore == round((80 * 60 + 75 * 15 + 100 * 15) / 90, 2)
    assert result.components.education.contribution is None


def test_spec_normalisation_example():
    # Required 80 (60%) and experience 100 (15%) only: (80*60 + 100*15) / 75 = 84.
    result = combine(scores(calc(80), NA, calc(100), NA))
    assert result.overallScore == 84
    assert (result.components.requiredSkills.effectiveWeight, result.components.experience.effectiveWeight) == (80, 20)
    assert (result.components.requiredSkills.contribution, result.components.experience.contribution) == (64, 20)


def test_5_only_required_skills():
    result = combine(scores(calc(62.5)))
    assert result.overallScore == 62.5
    assert result.components.requiredSkills.effectiveWeight == 100


def test_6_no_applicable_components():
    result = combine(scores())
    assert result.overallScore is None
    assert result.scoreStatus == "insufficient_data"
    assert all(getattr(result.components, n).contribution is None for n in ("requiredSkills", "preferredSkills", "experience", "education"))


def test_6b_only_unknown_components_give_no_score():
    assert combine(scores(NA, NA, UNKNOWN, UNKNOWN)).overallScore is None


def test_7_experience_above_requirement_is_capped():
    experience = ExperienceMatch(status="compared", requiredYears=3, candidateYears=5, meetsRequirement=True)
    assert score_experience(experience) == ComponentScore(100, "calculated")


def test_8_zero_required_skills_no_division_by_zero():
    assert score_skills(SkillComparison(coverage=None), "required").status == "not_applicable"
    result = match_resume_to_job(resume(["React"]), job(preferred=["React"]), today=date(2026, 10, 1))
    score = calculate_match_score(result)
    assert score.components.requiredSkills.status == "not_applicable"
    assert score.overallScore == 100


def test_9_zero_preferred_skills_no_division_by_zero():
    assert score_skills(SkillComparison(coverage=None), "preferred").status == "not_applicable"
    result = match_resume_to_job(resume(["React"]), job(["React", "Go"]), today=date(2026, 10, 1))
    assert calculate_match_score(result).overallScore == 50


def test_10_rounding():
    assert round_score(66.666666) == 66.67
    assert round_score(2 / 3 * 100) == 66.67
    assert round_score(100.0) == 100 and isinstance(round_score(100.0), int)
    experience = ExperienceMatch(status="compared", requiredYears=3, candidateYears=2, meetsRequirement=False)
    assert combine(scores(experience=score_experience(experience))).overallScore == 66.67


# --- Component scores -----------------------------------------------------


def test_skill_score_uses_exact_counts_not_rounded_coverage():
    comparison = SkillComparison(matched=["A"], missing=["B", "C"], coverage=33.3)
    assert combine(scores(score_skills(comparison, "required"))).overallScore == 33.33


@pytest.mark.parametrize(
    "experience, expected",
    [
        (ExperienceMatch(status="not_applicable"), ("not_applicable", None)),
        (ExperienceMatch(status="compared", requiredYears=3, candidateYears=None, candidateYearsReason="Some job dates give only a year"), ("insufficient_data", None)),
        (ExperienceMatch(status="compared", requiredYears=3, candidateYears=1.5), ("calculated", 50)),
        (ExperienceMatch(status="compared", requiredYears=3, candidateYears=0), ("calculated", 0)),
        (ExperienceMatch(status="compared", requiredYears=0, candidateYears=0), ("calculated", 100)),
    ],
)
def test_experience_component(experience, expected):
    result = score_experience(experience)
    assert (result.status, result.score) == expected


def test_experience_reason_is_passed_through():
    experience = ExperienceMatch(status="compared", requiredYears=3, candidateYears=None, candidateYearsReason="Some job dates give only a year, not a month")
    assert score_experience(experience).reason == "Some job dates give only a year, not a month"


def test_skill_specific_experience_only_is_insufficient_data():
    result = match_resume_to_job(
        resume(["React"], experience=[{"startDate": "Jan 2020", "endDate": "Dec 2024", "text": "React"}]),
        job(experience=[{"minimumYears": 3, "areas": ["React"]}]),
        today=date(2026, 10, 1),
    )
    assert score_experience(result.experience).status == "insufficient_data"


def test_preferred_only_experience_is_not_applicable():
    result = match_resume_to_job(resume(), job(experience=[{"minimumYears": 5, "preferred": True}]), today=date(2026, 10, 1))
    assert score_experience(result.experience).status == "not_applicable"


def _education(*outcomes, preferred=False) -> EducationMatch:
    return EducationMatch.model_validate(
        {"status": "compared", "requirements": [{"meetsRequirement": o, "preferred": preferred} for o in outcomes]}
    )


@pytest.mark.parametrize(
    "education, expected",
    [
        (EducationMatch(status="not_applicable"), ("not_applicable", None)),
        (_education(True), ("calculated", 100)),
        (_education(False), ("calculated", 0)),
        (_education(None), ("insufficient_data", None)),
        (_education(False, True), ("calculated", 100)),  # alternatives: one met is enough
        (_education(False, None), ("insufficient_data", None)),
        (_education(False, preferred=True), ("not_applicable", None)),
    ],
)
def test_education_component(education, expected):
    result = score_education(education)
    assert (result.status, result.score) == expected


# --- Weights and metadata -------------------------------------------------


def test_default_weights_and_metadata():
    result = combine(scores(calc(50)))
    assert result.scoreMetadata.model_dump() == {
        "scoringMethod": "weighted_deterministic",
        "version": "1.0",
        "weights": {"requiredSkills": 60, "preferredSkills": 15, "experience": 15, "education": 10},
    }
    assert MATCHING_WEIGHTS == {"requiredSkills": 0.60, "preferredSkills": 0.15, "experience": 0.15, "education": 0.10}


def test_custom_weights():
    weights = {"requiredSkills": 0.5, "preferredSkills": 0.0, "experience": 0.25, "education": 0.25}
    result = combine(scores(calc(80), calc(0), calc(100), calc(0)), weights)
    assert result.overallScore == 65
    assert result.scoreMetadata.weights.preferredSkills == 0


@pytest.mark.parametrize(
    "weights",
    [
        {"requiredSkills": 0.6, "preferredSkills": 0.15, "experience": 0.15, "education": 0.2},
        {"requiredSkills": 1.1, "preferredSkills": -0.1, "experience": 0, "education": 0},
    ],
)
def test_invalid_weights_rejected(weights):
    with pytest.raises(ValueError):
        validate_weights(weights)


def test_contributions_add_up_to_the_overall_score():
    result = combine(scores(calc(73), calc(41), calc(88.8), NA))
    total = sum(
        getattr(result.components, n).contribution or 0 for n in ("requiredSkills", "preferredSkills", "experience", "education")
    )
    assert abs(total - result.overallScore) <= 0.02


def test_score_is_deterministic():
    result = match_resume_to_job(resume(["React", "Git"]), job(["React", "Go"], ["Git"]), today=date(2026, 10, 1))
    assert len({calculate_match_score(result).model_dump_json() for _ in range(5)}) == 1
