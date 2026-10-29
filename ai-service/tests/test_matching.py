from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.matching import JobRequirementsInput, MatchingRequest, ResumeExperienceInput, ResumeMatchInput
from app.services.education_matcher import compare_education, degree_level, field_matches
from app.services.experience_matcher import calculate_total_years, compare_experience
from app.services.resume_job_matcher import match_resume_to_job

client = TestClient(app)

URL = "/api/matching/analyze"
TODAY = date(2026, 10, 1)


def resume(skills=None, experience=None, education=None) -> ResumeMatchInput:
    return ResumeMatchInput.model_validate(
        {"skills": skills or [], "experience": experience or [], "education": education or []}
    )


def job(required=None, preferred=None, experience=None, education=None) -> JobRequirementsInput:
    return JobRequirementsInput.model_validate(
        {
            "requiredSkills": required or [],
            "preferredSkills": preferred or [],
            "experienceRequirements": experience or [],
            "educationRequirements": education or [],
        }
    )


def match(r, j):
    return match_resume_to_job(r, j, "r1", "j1", today=TODAY)


def jobs(*ranges) -> list[dict]:
    return [{"startDate": s, "endDate": e, "isCurrent": e is None} for s, e in ranges]


# --- Required skills ------------------------------------------------------


def test_spec_required_skill_example():
    result = match(resume(["Python", "React", "JavaScript", "MySQL", "Git"]), job(["React", "TypeScript", "JavaScript", "Git"]))
    assert result.skills.required.matched == ["React", "JavaScript", "Git"]
    assert result.skills.required.missing == ["TypeScript"]
    assert result.skills.required.coverage == 75


def test_matching_is_case_insensitive_and_uses_aliases():
    result = match(resume(["react", "JS", "nodejs"]), job(["React", "JavaScript", "REACT", "ReactJS", "Node.js"]))
    assert result.skills.required.matched == ["React", "JavaScript", "Node.js"]
    assert result.summary.requiredSkillCount == 3


def test_categorised_resume_skills_are_accepted():
    result = match(resume({"frontend": ["React"], "tools": ["Git"]}), job(["Git", "React"]))
    assert result.skills.required.matched == ["Git", "React"]


@pytest.mark.parametrize("candidate, wanted", [("React", "Java"), ("JavaScript", "Java"), ("Java", "JavaScript"), ("C", "C++")])
def test_different_skills_never_match(candidate, wanted):
    result = match(resume([candidate]), job([wanted]))
    assert result.skills.required.matched == []
    assert result.skills.required.missing == [wanted]


def test_skills_grouped_by_dictionary_category():
    result = match(resume(["JavaScript", "React"]), job(["JavaScript", "TypeScript", "React", "Next.js"]))
    by_category = {k: v.model_dump() for k, v in result.skills.required.byCategory.items()}
    assert by_category == {
        "programming_languages": {"matched": ["JavaScript"], "missing": ["TypeScript"]},
        "frontend": {"matched": ["React"], "missing": ["Next.js"]},
    }


def test_unknown_job_skill_is_kept_and_uncategorised():
    result = match(resume(["React"]), job(["React", "Kafka"]))
    assert result.skills.required.missing == ["Kafka"]
    assert result.skills.required.byCategory["uncategorized"].missing == ["Kafka"]


# --- Preferred skills -----------------------------------------------------


def test_spec_preferred_skill_example():
    result = match(resume(["React", "JavaScript", "Git"]), job(["React", "JavaScript"], ["Next.js", "Docker"]))
    assert result.skills.preferred.matched == []
    assert result.skills.preferred.missing == ["Next.js", "Docker"]
    assert result.skills.preferred.coverage == 0
    # Preferred skills are not counted as required.
    assert result.skills.required.coverage == 100


def test_preferred_coverage_and_statistics():
    result = match(resume(["React", "JavaScript", "Git", "Docker"]), job(["React", "TypeScript", "JavaScript", "Git"], ["Next.js", "Docker"]))
    assert result.skills.preferred.matched == ["Docker"]
    assert result.skills.preferred.coverage == 50
    assert result.summary.model_dump() == {
        "requiredSkillCount": 4,
        "matchedRequiredSkillCount": 3,
        "missingRequiredSkillCount": 1,
        "preferredSkillCount": 2,
        "matchedPreferredSkillCount": 1,
        "missingPreferredSkillCount": 1,
    }


def test_skill_in_both_lists_counts_as_required_only():
    result = match(resume(["Docker"]), job(["Docker"], ["docker", "Go"]))
    assert result.skills.required.matched == ["Docker"]
    assert result.skills.preferred.missing == ["Go"]
    assert result.summary.preferredSkillCount == 1


def test_coverage_is_rounded():
    result = match(resume(["Python"]), job(["Python", "Go", "Rust"]))
    assert result.skills.required.coverage == 33.3


# --- Skill edge cases -----------------------------------------------------


def test_no_required_or_preferred_skills_gives_null_coverage():
    result = match(resume(["React"]), job())
    assert result.skills.required.coverage is None
    assert result.skills.preferred.coverage is None
    assert result.skills.required.matched == result.skills.required.missing == []


def test_resume_without_skills_misses_everything():
    result = match(resume([]), job(["React", "Git"], ["Docker"]))
    assert result.skills.required.matched == []
    assert result.skills.required.missing == ["React", "Git"]
    assert result.skills.required.coverage == 0
    assert result.skills.preferred.missing == ["Docker"]


# --- Total experience -----------------------------------------------------


@pytest.mark.parametrize(
    "ranges, years",
    [
        ([("Jan 2022", "Dec 2023")], 2),
        ([("Jan 2022", "Dec 2023"), ("Jan 2023", "Dec 2024")], 3),  # overlap counted once
        ([("Jan 2020", "Dec 2020"), ("Jan 2022", "Jun 2022")], 1.5),  # gap not counted
        ([("Jan 2020", "Dec 2024"), ("Mar 2021", "Apr 2021")], 5),  # nested job
        ([("01/2024", "06/2024")], 0.5),
        ([("Oct 2023", None)], 3.1),  # Present: Oct 2023 - Oct 2026
        ([("Sept. 2021", "August 2022")], 1),
        ([("Jan '23", "Dec '23")], 1),
    ],
)
def test_total_experience(ranges, years):
    entries = [ResumeExperienceInput.model_validate(e) for e in jobs(*ranges)]
    assert calculate_total_years(entries, TODAY) == (years, None)


@pytest.mark.parametrize(
    "entry, reason_part",
    [
        ({"startDate": "2019", "endDate": "2021"}, "only a year"),
        ({"startDate": "Jan 2020"}, "no end date"),
        ({"endDate": "Jan 2020"}, "no start"),
        ({"startDate": "Dec 2022", "endDate": "Jan 2020"}, "out of order"),
        ({"startDate": "Jan 2030", "isCurrent": True}, "future"),
        ({"startDate": "Spring 2020", "endDate": "Jan 2021"}, "cannot be read"),
    ],
)
def test_incomplete_dates_are_not_guessed(entry, reason_part):
    entries = [
        ResumeExperienceInput.model_validate({"startDate": "Jan 2015", "endDate": "Dec 2016"}),
        ResumeExperienceInput.model_validate(entry),
    ]
    years, reason = calculate_total_years(entries, TODAY)
    assert years is None
    assert reason_part in reason


# --- Experience comparison ------------------------------------------------


def test_experience_requirement_met():
    result = match(resume(experience=jobs(("Jan 2021", "Dec 2023"))), job(experience=[{"minimumYears": 2, "text": "2+ years"}]))
    assert (result.experience.requiredYears, result.experience.candidateYears, result.experience.meetsRequirement) == (2, 3, True)


def test_experience_requirement_not_met():
    result = match(resume(experience=jobs(("Jan 2023", "Dec 2023"))), job(experience=[{"minimumYears": 3, "text": "3+ years"}]))
    assert (result.experience.requiredYears, result.experience.candidateYears, result.experience.meetsRequirement) == (3, 1, False)


def test_experience_unknown_when_dates_unreliable():
    result = match(resume(experience=[{"startDate": "2019", "endDate": "2021"}]), job(experience=[{"minimumYears": 2}]))
    assert (result.experience.requiredYears, result.experience.candidateYears, result.experience.meetsRequirement) == (2, None, None)
    assert result.experience.candidateYearsReason


def test_no_experience_requirement_is_not_applicable():
    result = match(resume(experience=jobs(("Jan 2021", "Dec 2023"))), job())
    assert result.experience.status == "not_applicable"
    assert result.experience.requirements == []


def test_range_requirement_uses_the_minimum():
    result = match(resume(experience=jobs(("Jan 2016", "Dec 2023"))), job(experience=[{"minimumYears": 3, "maximumYears": 5}]))
    assert result.experience.meetsRequirement is True
    assert result.experience.requirements[0].maximumYears == 5


def test_preferred_requirement_is_compared_but_not_the_headline():
    result = match(
        resume(experience=jobs(("Jan 2023", "Dec 2023"))),
        job(experience=[{"minimumYears": 1}, {"minimumYears": 5, "preferred": True}]),
    )
    assert result.experience.requiredYears == 1 and result.experience.meetsRequirement is True
    assert result.experience.requirements[1].meetsRequirement is False


def test_area_experience_is_not_claimed_from_a_skill_mention():
    # React is in the resume, but no dated job mentions it.
    r = resume(["React"], experience=[{"startDate": "Jan 2020", "endDate": "Dec 2024", "text": "Java backend work"}])
    result = match(r, job(experience=[{"minimumYears": 3, "areas": ["React"]}]))
    [area] = result.experience.requirements[0].areas
    assert (area.area, area.requiredYears, area.candidateYears, area.meetsRequirement) == ("React", 3, None, None)


def test_area_experience_from_dated_jobs_that_mention_the_skill():
    r = resume(
        ["React"],
        experience=[
            {"startDate": "Jan 2019", "endDate": "Dec 2020", "text": "Built ReactJS dashboards"},
            {"startDate": "Jan 2021", "endDate": "Dec 2022", "text": "Led React migration"},
            {"startDate": "Jan 2023", "endDate": "Dec 2024", "text": "Go services"},
        ],
    )
    result = match(r, job(experience=[{"minimumYears": 3, "areas": ["React"]}, {"minimumYears": 5, "areas": ["React"]}]))
    met, short = (req.areas[0] for req in result.experience.requirements)
    assert (met.candidateYears, met.meetsRequirement) == (4, True)
    # 4 years of evidence is a lower bound: it cannot prove 5 years are missing.
    assert (short.candidateYears, short.meetsRequirement) == (4, None)


def test_area_skill_absent_from_resume_is_not_met():
    result = match(resume(["Python"], experience=jobs(("Jan 2015", "Dec 2024"))), job(experience=[{"minimumYears": 2, "areas": ["Go"]}]))
    assert result.experience.requirements[0].areas[0].meetsRequirement is False
    assert result.experience.requirements[0].meetsRequirement is False


def test_compare_experience_directly():
    r = resume(experience=jobs(("Jan 2021", "Dec 2023")))
    result = compare_experience(r, job(experience=[{"minimumYears": 2}]), set(), today=TODAY)
    assert result.meetsRequirement is True


# --- Education ------------------------------------------------------------


@pytest.mark.parametrize(
    "degree, level",
    [
        ("B.Tech", "bachelor"),
        ("B.E.", "bachelor"),
        ("B.Sc", "bachelor"),
        ("BCA", "bachelor"),
        ("Bachelor's degree", "bachelor"),
        ("Bachelor of Science", "bachelor"),
        ("M.Tech", "master"),
        ("MBA", "master"),
        ("Master's degree", "master"),
        ("Ph.D", "doctorate"),
        ("Higher Secondary", "secondary"),
        ("PGDM", None),
        ("Postgraduate Diploma", None),
        ("Certificate", None),
    ],
)
def test_degree_levels(degree, level):
    assert degree_level(degree) == level


def _edu(resume_education, requirement):
    return compare_education(resume(education=resume_education), job(education=[requirement])).requirements[0]


def test_spec_education_example():
    result = _edu([{"degree": "B.Tech", "field": "Computer Science"}], {"degree": "Bachelor's degree", "fields": ["Computer Science"]})
    assert (result.requirement, result.candidateEducation, result.meetsRequirement, result.fieldMatch) == (
        "Bachelor's degree",
        "B.Tech Computer Science",
        True,
        True,
    )


def test_masters_required_bachelors_held():
    result = _edu([{"degree": "B.E.", "field": "Mechanical Engineering"}], {"degree": "Master's degree"})
    assert result.meetsRequirement is False


def test_higher_degree_meets_lower_requirement():
    result = _edu([{"degree": "B.Sc"}, {"degree": "M.Tech", "field": "Data Science"}], {"degree": "Bachelor's degree"})
    assert (result.candidateEducation, result.meetsRequirement) == ("M.Tech Data Science", True)


def test_alternatives_accept_the_lowest():
    assert _edu([{"degree": "BCA"}], {"degree": "B.E./B.Tech/MCA"}).meetsRequirement is True
    assert _edu([{"degree": "Diploma"}], {"degree": "Bachelor's or Master's degree"}).meetsRequirement is False


def test_missing_education_is_unknown():
    result = _edu([], {"degree": "Bachelor's degree"})
    assert (result.candidateEducation, result.meetsRequirement) == (None, None)


def test_ambiguous_degrees_are_unknown():
    assert _edu([{"degree": "PGDM"}], {"degree": "Master's degree"}).meetsRequirement is None
    assert _edu([{"degree": "B.Tech"}], {"degree": None, "fields": ["Computer Science"]}).meetsRequirement is None


def test_no_education_requirement_is_not_applicable():
    assert compare_education(resume(education=[{"degree": "B.Tech"}]), job()).status == "not_applicable"


@pytest.mark.parametrize(
    "candidate, required, expected",
    [
        ("Computer Science", ["Computer Science"], True),
        ("CSE", ["Computer Science"], True),
        ("Computer Science and Engineering", ["CS"], True),
        ("Information Technology", ["IT", "Computer Science"], True),
        ("Mechanical Engineering", ["Computer Science"], False),
        ("Political Science", ["Computer Science"], False),
        (None, ["Computer Science"], None),
        ("Computer Science", [], None),
    ],
)
def test_field_matching(candidate, required, expected):
    assert field_matches(candidate, required) is expected


def test_field_mismatch_does_not_decide_the_degree_result():
    result = _edu([{"degree": "B.Tech", "field": "Mechanical Engineering"}], {"degree": "Bachelor's degree", "fields": ["Computer Science"]})
    assert (result.meetsRequirement, result.fieldMatch) == (True, False)


# --- Determinism and API --------------------------------------------------

PAYLOAD = {
    "resume_id": "resume-123",
    "job_description_id": "job-456",
    "resume": {
        "skills": {"frontend": ["React"], "programming_languages": ["JavaScript"], "tools": ["Git"], "cloud": ["Docker"]},
        "experience": [{"startDate": "Jan 2021", "endDate": "Dec 2023", "isCurrent": False, "text": "React apps"}],
        "education": [{"degree": "B.Tech", "field": "Computer Science"}],
    },
    "job_requirements": {
        "requiredSkills": ["React", "TypeScript", "JavaScript", "Git"],
        "preferredSkills": ["Next.js", "Docker"],
        "experienceRequirements": [{"minimumYears": 2, "maximumYears": None, "areas": [], "preferred": False, "text": "2+ years"}],
        "educationRequirements": [{"degree": "Bachelor's degree", "fields": ["Computer Science"], "preferred": False, "text": "x"}],
    },
}


def test_endpoint_contract():
    response = client.post(URL, json=PAYLOAD)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["message"] == "Resume and job requirements analyzed successfully"
    m = body["data"]["matching"]
    assert (m["resumeId"], m["jobDescriptionId"]) == ("resume-123", "job-456")
    assert m["skills"]["required"]["matched"] == ["React", "JavaScript", "Git"]
    assert m["skills"]["required"]["coverage"] == 75
    assert m["skills"]["preferred"]["coverage"] == 50
    assert (m["experience"]["requiredYears"], m["experience"]["candidateYears"], m["experience"]["meetsRequirement"]) == (2, 3, True)
    assert m["education"]["requirements"][0]["meetsRequirement"] is True
    # Step 6B adds the score alongside, without replacing the comparison.
    assert (m["overallScore"], m["scoreStatus"]) == (77.5, "calculated")
    assert m["components"]["requiredSkills"] == {
        "score": 75,
        "weight": 60,
        "effectiveWeight": 60,
        "contribution": 45,
        "status": "calculated",
        "reason": None,
    }
    assert m["scoreMetadata"]["version"] == "1.0"


def test_repeated_matching_is_deterministic():
    responses = [client.post(URL, json=PAYLOAD).json() for _ in range(5)]
    assert all(r == responses[0] for r in responses)


def test_request_model_drops_unexpected_fields():
    payload = {**PAYLOAD, "resume": {**PAYLOAD["resume"], "rawPdf": "JVBERi0..."}}
    request = MatchingRequest.model_validate(payload)
    assert not hasattr(request.resume, "rawPdf")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.pop("resume"),
        lambda p: p.pop("job_requirements"),
        lambda p: p.update(resume_id=""),
        lambda p: p["job_requirements"].update(requiredSkills="React"),
        lambda p: p["job_requirements"]["experienceRequirements"][0].update(minimumYears=-1),
        lambda p: p["job_requirements"].update(requiredSkills=["x"] * 501),
        lambda p: p["resume"].update(experience=[{}] * 101),
    ],
)
def test_invalid_payloads_rejected(mutate):
    import copy

    payload = copy.deepcopy(PAYLOAD)
    mutate(payload)
    response = client.post(URL, json=payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_internal_errors_are_not_exposed(monkeypatch):
    def explode(request, today=None):
        raise RuntimeError("secret /srv/path")

    monkeypatch.setattr("app.routes.matching.analyze_match", explode)
    response = client.post(URL, json=PAYLOAD)
    assert response.status_code == 500
    assert response.json()["error"] == {"code": "MATCHING_FAILED", "details": None}
    assert "secret" not in response.text


def test_internal_api_key_enforced(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    assert client.post(URL, json=PAYLOAD).status_code == 401
    assert client.post(URL, json=PAYLOAD, headers={"X-Internal-API-Key": "test-key"}).status_code == 200
