from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.data.analysis_rules import MAX_GAPS, MAX_STRENGTHS
from app.main import app
from app.models.matching import SemanticErrorInput, SemanticMatchResult
from app.services.match_analysis_service import analyze_match_results
from app.services.match_score_calculator import score_matching_result
from app.services.resume_job_matcher import match_resume_to_job
from tests.test_matching import job, resume

client = TestClient(app)
URL = "/api/matching/analysis"
TODAY = date(2026, 10, 1)

FORBIDDEN_WORDS = ("excellent", "poor", "best candidate", "weak candidate", "strong candidate", "hire", "talented", "employable", "probab")


def matched(r=None, j=None):
    return score_matching_result(match_resume_to_job(r or resume(), j or job(), "r1", "j1", today=TODAY))


def component(similarity):
    if similarity is None:
        return {"similarity": None, "status": "not_available", "reason": "The resume lists no projects", "truncated": False}
    return {"similarity": similarity, "status": "calculated", "reason": None, "truncated": False}


def semantic(overall=70, experience=70, projects=70, skills=70) -> SemanticMatchResult:
    return SemanticMatchResult.model_validate(
        {
            "resumeId": "r1",
            "jobDescriptionId": "j1",
            "overallSemanticSimilarity": component(overall),
            "experienceSemanticSimilarity": component(experience),
            "projectSemanticSimilarity": component(projects),
            "skillsSemanticSimilarity": component(skills),
            "metadata": {"model": "sentence-transformers/all-MiniLM-L6-v2"},
        }
    )


def analyze(r=None, j=None, sem=None, error=None):
    return analyze_match_results(matched(r, j), sem, error)


def text_of(result) -> str:
    return result.model_dump_json().lower()


# --- Required skills ------------------------------------------------------


@pytest.mark.parametrize(
    "have, coverage, level",
    [
        (["A", "B", "C", "D", "E"], 100, "complete"),
        (["A", "B", "C", "D"], 80, "strong"),
        (["A", "B", "C"], 60, "partial"),
        (["A"], 20, "limited"),
        ([], 0, "none"),
    ],
)
def test_required_coverage_levels(have, coverage, level):
    skills = ["Python", "Go", "Rust", "Java", "Ruby"]
    candidate = [skills["ABCDE".index(x)] for x in have]
    result = analyze(resume(candidate), job(skills))
    assert (result.skills.required.coverage, result.skills.required.coverageLevel) == (coverage, level)


def test_complete_coverage_is_a_strength_without_gaps():
    result = analyze(resume(["React", "Git"]), job(["React", "Git"]))
    assert result.strengths[0].model_dump() == {"category": "skills", "message": "All 2 required skills were identified in the resume."}
    assert not [g for g in result.gaps if g.category == "required_skill"]


def test_strong_coverage_names_the_missing_skill():
    result = analyze(resume(["JavaScript", "React", "Node.js", "MySQL"]), job(["JavaScript", "React", "Node.js", "MySQL", "Docker"]))
    assert result.skills.required.coverageLevel == "strong"
    assert result.strengths[0].message == "Most required skills were identified in the resume (4 of 5)."
    assert result.gaps[0].model_dump() == {
        "category": "required_skill",
        "message": "Docker is listed as a required skill but was not detected in the resume.",
    }


def test_zero_coverage_creates_no_skill_strength():
    result = analyze(resume(["Python"]), job(["Go", "Rust"]))
    assert result.skills.required.coverageLevel == "none"
    assert not [s for s in result.strengths if s.category == "skills"]
    assert len([g for g in result.gaps if g.category == "required_skill"]) == 2


def test_no_required_skills_is_not_applicable():
    result = analyze(resume(["Python"]), job(preferred=["Go"]))
    assert result.skills.required.status == "not_applicable"
    assert result.skills.required.coverageLevel is None
    assert "The job lists no required skills." in result.dataQuality.notApplicable


def test_many_missing_required_skills_are_grouped():
    result = analyze(resume([]), job(["Go", "Rust", "Java", "Ruby", "PHP"]))
    [gap] = [g for g in result.gaps if g.category == "required_skill"]
    assert gap.message == "5 required skills were not detected in the resume: Go, Rust, Java, Ruby and PHP."


# --- Preferred skills -----------------------------------------------------


def test_preferred_all_matched():
    result = analyze(resume(["React", "Docker", "AWS"]), job(["React"], ["Docker", "AWS"]))
    assert (result.skills.preferred.coverage, result.skills.preferred.coverageLevel) == (100, "complete")
    assert any(s.message == "2 of 2 preferred skills were identified: Docker and AWS." for s in result.strengths)
    assert not [g for g in result.gaps if g.category == "preferred_skill"]


def test_preferred_partially_matched():
    result = analyze(resume(["React", "Docker"]), job(["React"], ["Docker", "AWS", "Kubernetes", "Git"]))
    assert result.skills.preferred.coverage == 25
    # Below the strength threshold: reported, but not as a strength.
    assert not any("preferred" in s.message for s in result.strengths)
    assert [g.message for g in result.gaps if g.category == "preferred_skill"] == ["Preferred skills not detected: AWS, Kubernetes and Git."]


def test_preferred_none_matched_is_not_a_critical_gap():
    result = analyze(resume(["React"]), job(["React"], ["Docker"]))
    assert result.skills.preferred.coverageLevel == "none"
    gap = next(g for g in result.gaps if "Docker" in g.message)
    assert gap.category == "preferred_skill"
    assert "required" not in gap.message


def test_no_preferred_skills_is_not_applicable():
    result = analyze(resume(["React"]), job(["React"]))
    assert result.skills.preferred.status == "not_applicable"
    # Only the missing semantic result is an issue; the absent preferred list is not.
    assert result.dataQuality.issues == ["Semantic similarity could not be calculated: Semantic similarity was not available."]
    assert "The job lists no preferred skills." in result.dataQuality.notApplicable


# --- Experience -----------------------------------------------------------


def _jobs(*ranges):
    return [{"startDate": s, "endDate": e} for s, e in ranges]


def test_experience_meets_requirement():
    result = analyze(resume(experience=_jobs(("Jan 2022", "Dec 2025"))), job(experience=[{"minimumYears": 3}]))
    assert result.experience.model_dump(exclude={"skillSpecific"}) == {
        "status": "satisfied",
        "requiredYears": 3,
        "candidateYears": 4,
        "score": 100,
        "reason": None,
    }
    assert any(s.message == "Available experience (4 years) meets the explicit requirement of 3 years." for s in result.strengths)


def test_experience_below_requirement():
    result = analyze(resume(experience=_jobs(("Jan 2024", "Dec 2025"))), job(experience=[{"minimumYears": 3}]))
    assert (result.experience.status, result.experience.requiredYears, result.experience.candidateYears, result.experience.score) == (
        "below_requirement",
        3,
        2,
        66.67,
    )
    assert any(g.message == "Available experience (2 years) is below the explicit requirement of 3 years." for g in result.gaps)
    assert not any(s.category == "experience" for s in result.strengths)


def test_no_experience_requirement():
    result = analyze(resume(experience=_jobs(("Jan 2022", "Dec 2025"))), job(["React"]))
    assert result.experience.status == "not_applicable"
    assert not any("Experience" in issue for issue in result.dataQuality.issues)
    assert "The job states no years of experience." in result.dataQuality.notApplicable


def test_experience_insufficient_data_is_not_a_negative_result():
    result = analyze(resume(experience=[{"startDate": "2019", "endDate": "2021"}]), job(experience=[{"minimumYears": 2}]))
    assert result.experience.status == "insufficient_data"
    assert result.experience.candidateYears is None and result.experience.score is None
    assert not any(g.category == "experience" for g in result.gaps)
    [gap] = [g for g in result.gaps if g.category == "insufficient_data"]
    assert gap.message.startswith("Experience could not be evaluated:")
    assert any("Experience could not be evaluated" in issue for issue in result.dataQuality.issues)


def test_skill_specific_experience():
    r = resume(["React"], experience=[{"startDate": "Jan 2020", "endDate": "Dec 2023", "text": "React apps"}])
    result = analyze(r, job(experience=[{"minimumYears": 3, "areas": ["React"]}, {"minimumYears": 2, "areas": ["Go"]}]))
    statuses = [(a.area, a.status) for a in result.experience.skillSpecific]
    assert statuses == [("React", "satisfied"), ("Go", "skill_not_found")]
    assert any("mentioning React covers at least 4 years" in s.message for s in result.strengths)
    assert any(g.message == "The job asks for 2 years of Go experience, but Go was not detected in the resume." for g in result.gaps)


# --- Education ------------------------------------------------------------


def test_education_satisfied():
    result = analyze(resume(education=[{"degree": "B.E.", "field": "Computer Science"}]), job(education=[{"degree": "Bachelor's degree"}]))
    assert result.education.model_dump() == {
        "status": "satisfied",
        "requiredDegree": "Bachelor's degree",
        "requiredFields": [],
        "candidateDegree": "B.E. Computer Science",
        "fieldMatch": None,
        "reason": None,
    }


def test_education_not_satisfied():
    result = analyze(resume(education=[{"degree": "B.Tech"}]), job(education=[{"degree": "Master's degree"}]))
    assert result.education.status == "not_satisfied"
    assert any(g.message == "The education requirement (Master's degree) is not met by the degree identified in the resume (B.Tech)." for g in result.gaps)


def test_no_education_requirement():
    result = analyze(resume(education=[{"degree": "B.Tech"}]), job(["React"]))
    assert result.education.status == "not_applicable"
    assert "The job states no education requirement." in result.dataQuality.notApplicable


def test_education_insufficient_data():
    result = analyze(resume(), job(education=[{"degree": "Bachelor's degree"}]))
    assert result.education.status == "insufficient_data"
    assert result.education.candidateDegree is None
    assert not any(g.category == "education" for g in result.gaps)
    assert any(g.category == "insufficient_data" and g.message.startswith("Education could not be evaluated") for g in result.gaps)


# --- Semantic analysis ----------------------------------------------------


@pytest.mark.parametrize(
    "value, level",
    [(95, "very_high"), (90, "very_high"), (80, "high"), (60, "moderate"), (30, "low"), (10, "very_low"), (0, "very_low")],
)
def test_similarity_levels(value, level):
    result = analyze(resume(["React"]), job(["React"]), semantic(overall=value))
    assert result.semanticSimilarity.overall.level == level


def test_high_semantic_similarity_is_a_strength():
    result = analyze(resume(["React"]), job(["Go"]), semantic(experience=91.2, projects=82.1))
    categories = [s.category for s in result.strengths]
    assert "semantic_similarity" in categories and "projects" in categories
    # Semantic similarity never turns a missing skill into a match.
    assert result.skills.required.missing == ["Go"]


def test_moderate_and_low_similarity_are_not_strengths():
    for value in (60, 30):
        result = analyze(resume(["React"]), job(["React"]), semantic(overall=value, experience=value, projects=value, skills=value))
        assert not any(s.category in ("semantic_similarity", "projects") for s in result.strengths)


def test_unavailable_semantic_result():
    error = SemanticErrorInput(code="EMBEDDING_MODEL_UNAVAILABLE", message="Semantic matching service is currently unavailable.")
    result = analyze(resume(["React"]), job(["React"]), None, error)
    assert result.semanticSimilarity.model_dump()["status"] == "unavailable"
    assert result.semanticSimilarity.reason == "Semantic matching service is currently unavailable."
    assert result.dataQuality.issues == ["Semantic similarity could not be calculated: Semantic matching service is currently unavailable."]
    assert result.dataQuality.status == "mostly_complete"
    # The deterministic analysis is unaffected.
    assert result.skills.required.coverageLevel == "complete"


def test_not_available_semantic_aspect():
    result = analyze(resume(["React"]), job(["React"]), semantic(projects=None))
    assert result.semanticSimilarity.projects.model_dump() == {"similarity": None, "level": None, "status": "not_available"}


def test_semantic_higher_than_exact_coverage_is_pointed_out_neutrally():
    result = analyze(resume(["React", "Go", "Rust"]), job(["React", "Go", "Rust", "Java", "Ruby"]), semantic(skills=88))
    comparison = result.semanticSimilarity.signalComparison
    assert (comparison.exactRequiredSkillCoverage, comparison.semanticSkillsSimilarity, comparison.difference) == (60, 88, 28)
    assert comparison.observation.startswith("Semantic similarity is higher than exact skill coverage")
    assert result.skills.required.missing == ["Java", "Ruby"]


def test_small_signal_difference_has_no_observation():
    result = analyze(resume(["React", "Go"]), job(["React", "Go"]), semantic(skills=90))
    assert result.semanticSimilarity.signalComparison.observation is None


def test_exact_higher_than_semantic_is_pointed_out():
    result = analyze(resume(["React"]), job(["React"]), semantic(skills=40))
    assert result.semanticSimilarity.signalComparison.observation.startswith("Exact skill coverage is higher")


# --- Strengths, gaps, data quality, overall --------------------------------


def test_no_evidence_means_no_strengths():
    result = analyze(resume([]), job(["Go"], ["Rust"], experience=[{"minimumYears": 5}], education=[{"degree": "Master's degree"}]))
    assert result.strengths == []


def test_strengths_and_gaps_are_capped():
    full = analyze(
        resume(
            ["A1", "React", "Docker", "AWS"],
            experience=[{"startDate": "Jan 2015", "endDate": "Dec 2024", "text": "React"}],
            education=[{"degree": "M.Tech"}],
        ),
        job(["React"], ["Docker", "AWS"], experience=[{"minimumYears": 3}, {"minimumYears": 2, "areas": ["React"]}], education=[{"degree": "Bachelor's degree"}]),
        semantic(experience=95, projects=95),
    )
    assert len(full.strengths) == MAX_STRENGTHS

    many_gaps = analyze(
        resume([], education=[{"degree": "B.Tech"}]),
        job(["Go", "Rust", "Java", "Ruby"], ["Docker"], experience=[{"minimumYears": 3}, {"minimumYears": 2, "areas": ["Go"]}, {"minimumYears": 2, "areas": ["Rust"]}], education=[{"degree": "Master's degree"}]),
    )
    assert len(many_gaps.gaps) == MAX_GAPS
    assert many_gaps.additionalGapCount >= 1


@pytest.mark.parametrize(
    "r, j, sem, status",
    [
        (resume(["React"]), job(["React"]), semantic(), "complete"),
        (resume(["React"], experience=[{"startDate": "2019", "endDate": "2021"}]), job(["React"], experience=[{"minimumYears": 1}]), semantic(), "mostly_complete"),
        (resume(["React"], experience=[{"startDate": "2019", "endDate": "2021"}]), job(["React"], experience=[{"minimumYears": 1}]), None, "partial"),
        (resume(), job(), None, "insufficient"),
    ],
)
def test_data_quality_status(r, j, sem, status):
    assert analyze(r, j, sem).dataQuality.status == status


def test_not_applicable_does_not_lower_data_quality():
    result = analyze(resume(["React"]), job(["React"]), semantic())
    assert result.dataQuality.status == "complete"
    assert len(result.dataQuality.notApplicable) == 3  # preferred skills, experience, education


def test_overall_summary_and_score_are_unchanged():
    m = matched(
        resume(["JavaScript", "React", "Node.js", "MySQL"], experience=_jobs(("Jan 2022", "Dec 2025")), education=[{"degree": "B.E."}]),
        job(["JavaScript", "React", "Node.js", "MySQL", "Docker"], experience=[{"minimumYears": 3}], education=[{"degree": "Bachelor's degree"}]),
    )
    result = analyze_match_results(m, semantic(overall=87.42))
    assert result.overall.matchScore == m.overallScore
    assert result.overall.scoreAvailable is True
    assert result.overall.summary == (
        "4 of 5 required skills were identified (strong coverage); the explicit experience requirement is met; "
        "the education requirement is met."
    )
    assert [h.category for h in result.overall.highlights] == ["required_skills", "experience", "education", "semantic_similarity"]


def test_overall_without_score():
    result = analyze(resume(), job())
    assert (result.overall.matchScore, result.overall.scoreAvailable) == (None, False)
    assert result.overall.summary == "Not enough comparable information was available to calculate a match score."


def test_no_candidate_ratings_or_predictions():
    for result in (
        analyze(resume(["React"]), job(["React"]), semantic(95, 95, 95, 95)),
        analyze(resume([]), job(["Go"]), semantic(5, 5, 5, 5)),
    ):
        text = text_of(result)
        assert not any(word in text for word in FORBIDDEN_WORDS)


def test_analysis_is_deterministic():
    results = {analyze(resume(["React"]), job(["React", "Go"]), semantic()).model_dump_json() for _ in range(5)}
    assert len(results) == 1


# --- API ------------------------------------------------------------------


def test_endpoint():
    m = matched(resume(["React"]), job(["React", "Go"]))
    response = client.post(URL, json={"matching": m.model_dump(), "semanticMatch": semantic().model_dump(), "semanticError": None})
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Match analysis generated successfully"
    analysis = body["data"]["analysis"]
    assert set(analysis) == {"overall", "skills", "experience", "education", "semanticSimilarity", "dataQuality", "strengths", "gaps", "additionalGapCount"}
    assert analysis["gaps"][0]["message"] == "Go is listed as a required skill but was not detected in the resume."


def test_endpoint_without_semantic_result():
    m = matched(resume(["React"]), job(["React"]))
    payload = {"matching": m.model_dump(), "semanticError": {"code": "EMBEDDING_MODEL_UNAVAILABLE", "message": "Semantic matching service is currently unavailable."}}
    response = client.post(URL, json=payload)
    assert response.status_code == 200
    assert response.json()["data"]["analysis"]["semanticSimilarity"]["status"] == "unavailable"


def test_endpoint_rejects_invalid_input():
    response = client.post(URL, json={"matching": {"resumeId": "r1"}})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_endpoint_hides_internal_errors(monkeypatch):
    def explode(*args):
        raise RuntimeError("secret /srv/path")

    monkeypatch.setattr("app.routes.matching.analyze_match_results", explode)
    m = matched(resume(["React"]), job(["React"]))
    response = client.post(URL, json={"matching": m.model_dump()})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "MATCH_ANALYSIS_FAILED"
    assert "secret" not in response.text


def test_endpoint_requires_internal_api_key(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    m = matched(resume(["React"]), job(["React"]))
    assert client.post(URL, json={"matching": m.model_dump()}).status_code == 401
