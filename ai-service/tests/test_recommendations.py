import copy
from datetime import date

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.data.recommendation_rules import MAX_RECOMMENDATIONS
from app.main import app
from app.models.matching import RecommendationResumeInput, ResumeRecommendation, SemanticMatchResult
from app.services.match_analysis_service import analyze_match_results
from app.services.match_score_calculator import score_matching_result
from app.services.resume_job_matcher import match_resume_to_job
from app.services.resume_recommendation_service import NO_RECOMMENDATIONS_MESSAGE, build_recommendations
from tests.test_matching import job, resume

client = TestClient(app)
URL = "/api/matching/recommendations"
TODAY = date(2026, 10, 26)

# Words that would turn a recommendation into a claim about the user or an invented result.
UNSUPPORTED = ("you have experience", "you are", "increase", "improved by", "%", "users", "revenue", "led a team", "guarantee", "hire")


def run(r=None, j=None, entries=None, semantic=None):
    """Steps 6A -> 6B -> 7A -> 7B on test data; returns (matching, recommendations)."""
    matching = score_matching_result(match_resume_to_job(r or resume(), j or job(), "r1", "j1", today=TODAY))
    analysis = analyze_match_results(matching, semantic)
    resume_input = RecommendationResumeInput.model_validate(entries or {})
    return matching, build_recommendations(matching, analysis, resume_input, today=TODAY)


def items(result, category=None):
    return [i for i in result.items if category is None or i.category == category]


def semantic_result(skills=95.0) -> SemanticMatchResult:
    component = {"similarity": 80.0, "status": "calculated", "reason": None, "truncated": False}
    return SemanticMatchResult.model_validate(
        {
            "resumeId": "r1",
            "jobDescriptionId": "j1",
            "overallSemanticSimilarity": component,
            "experienceSemanticSimilarity": component,
            "projectSemanticSimilarity": component,
            "skillsSemanticSimilarity": {**component, "similarity": skills},
            "metadata": {"model": "sentence-transformers/all-MiniLM-L6-v2"},
        }
    )


# 1. Missing required skill -> actionable recommendation ---------------------


def test_missing_required_skill_recommendation():
    _, result = run(resume(["React"]), job(["React", "Docker"]))
    [rec] = items(result, "required_skill")
    assert rec.model_dump() == {
        "id": "rec-001",
        "category": "required_skill",
        "priority": "high",
        "title": "Review the Docker requirement",
        "issue": "Docker was not detected in the resume.",
        "reason": "Docker is listed as a required skill for this position.",
        "action": "If you have used Docker, describe where and how you used it in the relevant work or project entry so it "
        "can be identified. If you have not, consider learning it before listing it as a skill.",
        "relatedSkills": ["Docker"],
        "evidence": "Job requirements list Docker as required; the resume parser did not detect it.",
    }


def test_many_missing_required_skills_are_grouped():
    _, result = run(resume([]), job(["Go", "Rust", "Java", "Ruby", "PHP"]))
    recs = items(result, "required_skill")
    assert [r.relatedSkills for r in recs] == [["Go"], ["Rust"], ["Java", "Ruby", "PHP"]]
    assert recs[-1].title == "Review 3 more required skills"


# 2. Missing preferred skill -> lower priority ------------------------------


def test_missing_preferred_skill_is_lower_priority():
    _, result = run(resume(["React"]), job(["React", "Go"], ["Docker"]))
    [preferred] = items(result, "preferred_skill")
    assert preferred.priority in ("medium", "low")
    assert "not required" in preferred.reason
    assert result.items[0].category == "required_skill"


def test_preferred_priority_depends_on_how_much_was_not_detected():
    _, most_missing = run(resume(["React"]), job(["React"], ["Docker", "AWS"]))
    _, few_missing = run(resume(["React", "Docker", "AWS"]), job(["React"], ["Docker", "AWS", "Git"]))
    assert items(most_missing, "preferred_skill")[0].priority == "medium"
    assert items(few_missing, "preferred_skill")[0].priority == "low"


# 3. Detected skills are not recommended as missing -------------------------


def test_detected_skill_is_not_recommended_as_missing():
    _, result = run(resume(["React", "reactjs", "Docker"]), job(["React", "Docker"], ["docker"]))
    assert items(result, "required_skill") == []
    assert items(result, "preferred_skill") == []
    assert not any("React" in r.relatedSkills or "Docker" in r.relatedSkills for r in items(result) if r.category.endswith("skill"))


# 4. Semantic similarity does not satisfy an exact skill --------------------


def test_semantic_similarity_does_not_satisfy_a_missing_skill():
    _, result = run(resume(["React"]), job(["React", "Kubernetes", "Docker"]), semantic=semantic_result(skills=95))
    assert [r.relatedSkills for r in items(result, "required_skill")] == [["Kubernetes"], ["Docker"]]
    [terminology] = [r for r in items(result, "resume_content") if r.title == "Use standard names for skills you have used"]
    assert "does not show that the missing skills are present" in terminology.reason
    assert "Do not add names of tools you have not used." in terminology.action


# 5. Experience gap only with reliable data ---------------------------------


def test_experience_gap_with_reliable_dates():
    r = resume(experience=[{"startDate": "Jan 2024", "endDate": "Dec 2025"}])
    _, result = run(r, job(experience=[{"minimumYears": 3}]))
    [rec] = items(result, "experience")
    assert rec.priority == "high"
    assert rec.issue == "The job specifies 3 years of experience; the dates in the resume add up to 2 years."
    assert "Do not change dates or add roles you did not hold." in rec.action


def test_no_experience_gap_when_requirement_is_met():
    r = resume(experience=[{"startDate": "Jan 2020", "endDate": "Dec 2025"}])
    _, result = run(r, job(experience=[{"minimumYears": 3}]))
    assert items(result, "experience") == [] and items(result, "data_quality") == []


# 6. Missing dates do not produce estimates --------------------------------


def test_incomplete_dates_ask_for_review_not_estimates():
    r = resume(experience=[{"startDate": "2019", "endDate": "2021"}])
    entries = {"experience": [{"title": "Developer", "company": "ABC", "startDate": "2019", "endDate": "2021", "description": ["Built APIs"]}]}
    _, result = run(r, job(experience=[{"minimumYears": 2}]), entries)
    assert items(result, "experience") == []
    [rec] = items(result, "data_quality")
    assert rec.priority == "medium"
    assert "only a year" in rec.issue
    assert rec.evidence == "Affected entries: Developer at ABC."
    assert "Do not guess dates" in rec.action
    assert not any(char.isdigit() for char in rec.issue.split(":")[-1])  # no estimated number of years


def test_skill_specific_requirement_is_a_limitation_not_a_recommendation():
    r = resume(["React"], experience=[{"startDate": "2019", "endDate": "2021", "text": "React"}])
    _, result = run(r, job(["React"], experience=[{"minimumYears": 3, "areas": ["React"]}]))
    assert any("specific skills" in limit for limit in result.limitations)


# 7/8. Project recommendations reference real content, invent nothing --------


PROJECT_JOB = job(["React", "Node.js"], ["Docker"])


@pytest.mark.parametrize(
    "project, title, issue_part",
    [
        ({"name": "Shop App", "description": [], "technologies": ["React"]}, "Describe the 'Shop App' project", "has no description"),
        ({"name": "Shop App", "description": ["Online store"], "technologies": ["React"]}, "Expand the description of the 'Shop App' project", "brief (2 words)"),
        (
            {"name": "Shop App", "description": ["An online store with a catalogue, a cart and a checkout built for a class assignment"], "technologies": ["React", "Node.js"]},
            "Explain how the 'Shop App' project used React and Node.js",
            "does not say how they were used",
        ),
    ],
)
def test_project_recommendation_references_existing_project(project, title, issue_part):
    _, result = run(resume(["React", "Node.js"]), PROJECT_JOB, {"projects": [project]})
    [rec] = items(result, "projects")
    assert (rec.title, rec.priority, rec.evidence) == (title, "medium", "Resume: the 'Shop App' project.")
    assert issue_part in rec.issue
    assert rec.action.startswith("If accurate")
    assert all(skill in project["technologies"] for skill in rec.relatedSkills)


def test_project_recommendations_invent_nothing():
    project = {"name": "Shop App", "description": ["Online store"], "technologies": ["React"]}
    _, result = run(resume(["React"]), PROJECT_JOB, {"projects": [project]})
    text = " ".join(f"{r.title} {r.issue} {r.reason} {r.action}" for r in items(result, "projects")).lower()
    assert not any(word in text for word in UNSUPPORTED)
    # Only the project name and skills from the inputs are named.
    assert "shop app" in text and "react" in text


def test_no_project_recommendation_without_evidence():
    projects = [
        {"name": "Recipe Blog", "description": ["Blog"], "technologies": ["Django"]},  # nothing relevant to the job
        {"name": "Dashboard", "description": ["A real-time dashboard for tracking warehouse orders, with a React front end and a Node.js API"], "technologies": ["React", "Node.js"]},
    ]
    _, result = run(resume(["React", "Node.js"]), PROJECT_JOB, {"projects": projects})
    assert items(result, "projects") == []


# 9. Not-applicable requirements ------------------------------------------


def test_not_applicable_requirements_generate_nothing():
    _, result = run(resume(["React"], education=[]), job(["React"]))
    assert items(result, "preferred_skill") == []
    assert items(result, "experience") == [] and items(result, "education") == [] and items(result, "data_quality") == []


# Education -------------------------------------------------------------------


def test_education_not_satisfied():
    _, result = run(resume(education=[{"degree": "B.Tech"}]), job(education=[{"degree": "Master's degree"}]))
    [rec] = items(result, "education")
    assert rec.priority == "high"
    assert "Do not list qualifications you have not completed." in rec.action


def test_education_not_detected_vs_job_ambiguity():
    _, missing_degree = run(resume(), job(education=[{"degree": "Bachelor's degree"}]))
    assert items(missing_degree, "data_quality")[0].title == "Check that your education can be detected"
    _, ambiguous_job = run(resume(education=[{"degree": "B.Tech"}]), job(education=[{"degree": None, "fields": ["Computer Science"]}]))
    assert items(ambiguous_job) == []
    assert any("does not name a degree level" in limit for limit in ambiguous_job.limitations)


# 10. Duplicates removed ----------------------------------------------------


def test_skill_specific_requirement_for_a_missing_required_skill_is_not_duplicated():
    _, result = run(resume([]), job(["Go"], experience=[{"minimumYears": 2, "areas": ["Go"]}]))
    assert [r.relatedSkills for r in result.items if "Go" in r.relatedSkills] == [["Go"]]


def test_no_duplicate_titles_or_ids():
    _, result = run(resume(["Python"]), job(["Go", "Rust"], ["Docker", "AWS"], experience=[{"minimumYears": 5}]))
    assert len({r.title for r in result.items}) == len(result.items)
    assert [r.id for r in result.items] == [f"rec-{i:03d}" for i in range(1, len(result.items) + 1)]


# 11. Count limit -----------------------------------------------------------


def test_recommendation_count_is_capped():
    entries = {
        "experience": [{"title": f"Role {i}", "company": "X", "startDate": "2019", "endDate": "2020"} for i in range(3)],
        "projects": [{"name": f"P{i}", "description": [], "technologies": ["React"]} for i in range(4)],
    }
    _, result = run(
        resume(["React", "Python"], experience=[{"startDate": "2019", "endDate": "2020"}]),
        job(["React", "Go", "Rust", "Java", "Ruby"], ["Docker", "AWS"], experience=[{"minimumYears": 5}, {"minimumYears": 2, "areas": ["Kafka"]}], education=[{"degree": "Master's degree"}]),
        entries,
    )
    assert result.total == len(result.items) == MAX_RECOMMENDATIONS
    priorities = [r.priority for r in result.items]
    assert priorities == sorted(priorities, key={"high": 0, "medium": 1, "low": 2}.__getitem__)


# 12. No actionable gaps -> empty list --------------------------------------


def test_no_actionable_gaps_returns_empty_list_with_message():
    entries = {"experience": [{"title": "Developer", "company": "ABC", "startDate": "Jan 2020", "endDate": "Dec 2025", "description": ["Built React apps"]}]}
    r = resume(["React"], experience=[{"startDate": "Jan 2020", "endDate": "Dec 2025", "text": "React"}], education=[{"degree": "B.Tech"}])
    _, result = run(r, job(["React"], experience=[{"minimumYears": 3}], education=[{"degree": "Bachelor's degree"}]), entries, semantic_result(skills=90))
    assert result.items == [] and result.total == 0
    assert result.message == NO_RECOMMENDATIONS_MESSAGE


# 13. Validation ------------------------------------------------------------

VALID = {
    "id": "rec-001",
    "category": "required_skill",
    "priority": "high",
    "title": "t",
    "issue": "i",
    "reason": "r",
    "action": "a",
    "relatedSkills": [],
    "evidence": None,
}


@pytest.mark.parametrize(
    "change",
    [
        {"category": "personality"},
        {"priority": "urgent"},
        {"priority": "HIGH"},
        {"id": "1"},
        {"title": ""},
        {"rawResumeText": "John Doe, john@example.com"},
    ],
)
def test_schema_rejects_invalid_values(change):
    with pytest.raises(ValidationError):
        ResumeRecommendation.model_validate({**VALID, **change})


def test_schema_accepts_valid_values():
    assert ResumeRecommendation.model_validate(VALID).category == "required_skill"


# 14. The deterministic score is unchanged -----------------------------------


def test_recommendations_do_not_change_the_score():
    matching, _ = run(resume(["React"]), job(["React", "Docker"], ["AWS"]))
    before = matching.model_dump()
    analysis = analyze_match_results(matching)
    build_recommendations(matching, analysis, RecommendationResumeInput(), today=TODAY)
    assert matching.model_dump() == before
    assert "overallScore" not in ResumeRecommendation.model_fields


# Content quality and privacy ------------------------------------------------


def test_listed_only_skills_and_undescribed_roles():
    entries = {"experience": [{"title": "Developer", "company": "ABC", "startDate": "Jan 2020", "endDate": "Dec 2025", "description": []}]}
    _, result = run(resume(["React", "Python"]), job(["React", "Python"]), entries)
    titles = {r.title for r in items(result, "resume_content")}
    assert titles == {"Show where you used your listed required skills", "Describe your responsibilities in this role"}


def test_recommendations_contain_no_personal_or_raw_text():
    entries = {
        "experience": [{"title": "Developer", "company": "ABC", "startDate": "2019", "endDate": "2021", "description": ["Contact john.doe@example.com"]}],
        "projects": [{"name": "Shop App", "description": ["Call +91 98765 43210"], "technologies": ["React"]}],
    }
    _, result = run(resume(["React"], experience=[{"startDate": "2019", "endDate": "2021"}]), job(["React", "Go"], experience=[{"minimumYears": 2}]), entries)
    text = result.model_dump_json()
    assert "john.doe" not in text and "98765" not in text


def test_deterministic():
    outputs = {run(resume(["React"]), job(["React", "Go"], ["AWS"]))[1].model_dump_json() for _ in range(3)}
    assert len(outputs) == 1


# API -----------------------------------------------------------------------


def _payload():
    matching, _ = run(resume(["React"]), job(["React", "Docker"]))
    return {
        "matching": matching.model_dump(),
        "analysis": analyze_match_results(matching).model_dump(),
        "resume": {"projects": [{"name": "Shop App", "description": [], "technologies": ["React"]}], "experience": []},
    }


def test_endpoint():
    response = client.post(URL, json=_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Resume recommendations generated successfully"
    recs = body["data"]["recommendations"]
    assert recs["total"] == len(recs["items"]) >= 1
    assert recs["items"][0]["title"] == "Review the Docker requirement"


def test_endpoint_drops_unexpected_fields():
    payload = _payload()
    payload["resume"]["personalInformation"] = {"email": "john@example.com"}
    payload["userId"] = "someone-else"
    response = client.post(URL, json=payload)
    assert response.status_code == 200
    assert "john@example.com" not in response.text


def test_endpoint_rejects_invalid_input():
    payload = copy.deepcopy(_payload())
    del payload["analysis"]
    response = client.post(URL, json=payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_endpoint_hides_internal_errors(monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("secret /srv/path")

    monkeypatch.setattr("app.routes.matching.build_recommendations", explode)
    response = client.post(URL, json=_payload())
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "RECOMMENDATIONS_FAILED"
    assert "secret" not in response.text


def test_endpoint_requires_internal_api_key(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    assert client.post(URL, json=_payload()).status_code == 401
