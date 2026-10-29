import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.job_education_extractor import extract_clause_education, extract_education_requirements
from app.services.job_experience_extractor import extract_clause_experience, extract_experience_requirements
from app.services.job_requirement_extractor import extract_job_requirements
from app.services.job_title_extractor import extract_job_title
from app.services.skill_extractor import extract_skills_in_order

client = TestClient(app)

URL = "/api/job-description/extract-requirements"

SPEC_EXAMPLE = """We are looking for a Frontend Developer with 2+ years
of experience in React and TypeScript.

Requirements:
- React
- TypeScript
- JavaScript
- Git

Nice to have:
- Next.js
- Tailwind CSS

Education:
Bachelor's degree in Computer Science."""


def years(requirements) -> list[tuple]:
    return [(r.minimumYears, r.maximumYears, r.areas) for r in requirements]


# --- Spec example ---------------------------------------------------------


def test_spec_example():
    r = extract_job_requirements(SPEC_EXAMPLE)
    assert r.jobTitle == "Frontend Developer"
    assert r.requiredSkills == ["React", "TypeScript", "JavaScript", "Git"]
    assert r.preferredSkills == ["Next.js", "Tailwind CSS"]
    assert r.mentionedSkills == []
    assert years(r.experienceRequirements) == [(2, None, ["React", "TypeScript"])]
    assert [(e.degree, e.fields) for e in r.educationRequirements] == [("Bachelor's degree", ["Computer Science"])]
    assert r.responsibilities == []


# --- Required skills ------------------------------------------------------


def test_required_skills_section():
    r = extract_job_requirements("Required Skills:\n- React\n- TypeScript\n- Node.js\n- MySQL")
    assert r.requiredSkills == ["React", "TypeScript", "Node.js", "MySQL"]


@pytest.mark.parametrize(
    "sentence, skill",
    [
        ("Must have React experience.", "React"),
        ("Strong knowledge of TypeScript required.", "TypeScript"),
        ("Candidates should have experience with Node.js.", "Node.js"),
        ("Proficiency in MySQL is required.", "MySQL"),
        ("You will need hands-on experience with Docker.", "Docker"),
        ("A solid understanding of Python is essential.", "Python"),
    ],
)
def test_required_wording_outside_sections(sentence, skill):
    r = extract_job_requirements(f"About the role\nWe build great products.\n{sentence}")
    assert r.requiredSkills == [skill]


def test_mentioned_skills_are_not_required():
    text = "About us\nOur stack: Go, Kafka and PostgreSQL.\n\nWhat you'll do\n- Build React applications\n- Deploy with Docker"
    r = extract_job_requirements(text)
    assert r.requiredSkills == [] and r.preferredSkills == []
    assert r.mentionedSkills == ["Go", "PostgreSQL", "React", "Docker"]


def test_intro_mention_without_cue_is_only_mentioned():
    r = extract_job_requirements("Our team works with React and Python every day.")
    assert r.requiredSkills == [] and r.mentionedSkills == ["React", "Python"]


# --- Preferred skills -----------------------------------------------------


def test_preferred_section():
    r = extract_job_requirements("Nice to have:\n\nNext.js\nTailwind CSS\nDocker")
    assert r.preferredSkills == ["Next.js", "Tailwind CSS", "Docker"]
    assert r.requiredSkills == []


@pytest.mark.parametrize(
    "line",
    [
        "Experience with Docker is a plus.",
        "Bonus: Docker",
        "Docker is good to have.",
        "Familiarity with Docker is desirable.",
        "Docker preferred.",
        "Docker knowledge would be beneficial.",
        "Docker is not required.",
        "Experience with Docker is useful.",
    ],
)
def test_preferred_wording(line):
    r = extract_job_requirements(f"Requirements:\n- Python\n- {line}")
    assert r.requiredSkills == ["Python"]
    assert r.preferredSkills == ["Docker"]


def test_skill_in_both_required_and_preferred_is_required_once():
    r = extract_job_requirements("Requirements:\n- React\n- Docker\n\nNice to have:\n- Docker\n- React\n- Next.js")
    assert r.requiredSkills == ["React", "Docker"]
    assert r.preferredSkills == ["Next.js"]


def test_mixed_cues_in_one_line_are_split_by_clause():
    r = extract_job_requirements("Must have Git experience; Kubernetes is a plus")
    assert r.requiredSkills == ["Git"] and r.preferredSkills == ["Kubernetes"]


def test_inline_label_applies_to_its_own_line_only():
    r = extract_job_requirements("Requirements:\n- Python\nNice to have: Docker\n- Django")
    assert r.requiredSkills == ["Python", "Django"]
    assert r.preferredSkills == ["Docker"]


# --- Skill matching -------------------------------------------------------


def test_javascript_does_not_produce_java():
    r = extract_job_requirements("Requirements:\n- JavaScript\n- JavaScript frameworks")
    assert r.requiredSkills == ["JavaScript"]


def test_react_not_found_in_unrelated_words():
    r = extract_job_requirements("Requirements:\n- Proactive and reactive problem solving\n- Reach customers")
    assert r.requiredSkills == []


def test_aliases_map_to_resume_canonical_names():
    r = extract_job_requirements("Requirements:\n- ReactJS\n- NextJS\n- Node\n- JS and TS\n- Postgres")
    assert r.requiredSkills == ["React", "Next.js", "Node.js", "JavaScript", "TypeScript", "PostgreSQL"]


def test_duplicate_skills_give_canonical_unique_list():
    r = extract_job_requirements("Requirements:\n- React\n- ReactJS\n- React.js and react\n- Strong React skills required")
    assert r.requiredSkills == ["React"]


def test_ordered_skill_helper_uses_the_same_matcher():
    assert extract_skills_in_order("TypeScript, React and JS") == ["TypeScript", "React", "JavaScript"]


# --- Experience -----------------------------------------------------------


@pytest.mark.parametrize(
    "clause, minimum, maximum",
    [
        ("2+ years of experience", 2, None),
        ("minimum 3 years experience", 3, None),
        ("3-5 years of experience", 3, 5),
        ("3 to 5 years of relevant experience", 3, 5),
        ("at least 2 years of experience", 2, None),
        ("2 years or more of experience", 2, None),
        ("Experience: 4 yrs", 4, None),
        ("five years of experience", 5, None),
        ("1.5 years of experience", 1.5, None),
        ("up to 3 years of experience", None, 3),
        ("Experienced engineer (5+ years)", 5, None),
    ],
)
def test_experience_patterns(clause, minimum, maximum):
    [requirement] = extract_clause_experience(clause, in_requirement_section=False, preferred=False)
    assert (requirement.minimumYears, requirement.maximumYears) == (minimum, maximum)


def test_experience_areas_use_canonical_skills():
    [requirement] = extract_experience_requirements("3+ years of experience with ReactJS and TS")
    assert requirement.areas == ["React", "TypeScript"]


def test_experience_without_identifiable_area():
    [requirement] = extract_experience_requirements("3+ years of experience in software development")
    assert requirement.areas == []


def test_multiple_experience_requirements_in_one_line():
    requirements = extract_clause_experience("3+ years React, 2+ years Node.js", in_requirement_section=True, preferred=False)
    assert years(requirements) == [(3, None, ["React"]), (2, None, ["Node.js"])]


def test_years_in_requirement_section_without_the_word_experience():
    r = extract_job_requirements("Requirements:\n- 2+ years in React development\n- At least 2 years with AWS")
    assert years(r.experienceRequirements) == [(2, None, ["React"]), (2, None, ["AWS"])]
    assert r.requiredSkills == ["React", "AWS"]


def test_preferred_experience_is_marked():
    r = extract_job_requirements("Nice to have:\n- 5+ years of experience with Go")
    assert r.experienceRequirements[0].preferred is True
    assert r.preferredSkills == ["Go"]


# --- Education ------------------------------------------------------------


@pytest.mark.parametrize(
    "clause, degree, fields",
    [
        ("Bachelor's degree", "Bachelor's degree", []),
        ("Bachelor's degree in Computer Science", "Bachelor's degree", ["Computer Science"]),
        ("B.Tech in Computer Science", "B.Tech", ["Computer Science"]),
        ("B.E./B.Tech", "B.E./B.Tech", []),
        ("Master's degree", "Master's degree", []),
        ("MBA", "MBA", []),
        ("M.Tech", "M.Tech", []),
        ("Degree in Computer Science or related field", None, ["Computer Science"]),
        (
            "Bachelor's or Master's degree in Computer Science, Engineering or a related technical discipline",
            "Bachelor's or Master's degree",
            ["Computer Science", "Engineering"],
        ),
        ("BS/MS in Computer Science or equivalent experience", "BS/MS", ["Computer Science"]),
        ("Ph.D. in Machine Learning", "Ph.D", ["Machine Learning"]),
    ],
)
def test_education_patterns(clause, degree, fields):
    requirement = extract_clause_education(clause, in_education_section=True, preferred=False)
    assert (requirement.degree, requirement.fields) == (degree, fields)


@pytest.mark.parametrize(
    "clause",
    ["Proficiency in MS Office", "Intermediate knowledge of SQL", "Experience as a BA is helpful", "Great team culture"],
)
def test_no_education_requirement_invented(clause):
    assert extract_education_requirements(clause) == []


def test_preferred_education_is_marked():
    r = extract_job_requirements("Requirements:\n- Bachelor's degree in CS\n- Master's degree preferred")
    assert [(e.degree, e.preferred) for e in r.educationRequirements] == [
        ("Bachelor's degree", False),
        ("Master's degree", True),
    ]


def test_education_in_benefits_is_not_a_requirement():
    r = extract_job_requirements("Benefits\n- We sponsor Master's degrees for employees")
    assert r.educationRequirements == []


# --- Responsibilities -----------------------------------------------------


def test_responsibilities_bullets_extracted():
    text = (
        "Responsibilities:\n"
        "- Build React applications\n"
        "- Collaborate with backend developers\n"
        "- Write reusable components\n"
        "- Review code"
    )
    r = extract_job_requirements(text)
    assert r.responsibilities == [
        "Build React applications",
        "Collaborate with backend developers",
        "Write reusable components",
        "Review code",
    ]
    # Duties do not turn skills into requirements.
    assert r.requiredSkills == [] and r.mentionedSkills == ["React"]


@pytest.mark.parametrize("heading", ["What you'll do", "What you’ll do", "WHAT YOU WILL DO", "Duties", "Role", "Key Responsibilities:"])
def test_responsibility_heading_aliases(heading):
    r = extract_job_requirements(f"{heading}\n• Ship features\n• Wrapped bullet that continues\n  on the next line")
    assert r.responsibilities == ["Ship features", "Wrapped bullet that continues on the next line"]


# --- Job title and details ------------------------------------------------


def test_provided_title_wins():
    assert extract_job_title("Senior React Developer\n...", provided_title="Frontend Developer") == "Frontend Developer"


@pytest.mark.parametrize(
    "text, title",
    [
        ("Senior React Developer\nWe build things.", "Senior React Developer"),
        ("Backend Engineer - Example Technologies\nAbout us", "Backend Engineer"),
        ("Job Title: Software Engineer\nLocation: Remote", "Software Engineer"),
        ("About us\nWe are hiring a Senior Data Scientist to join our team.", "Senior Data Scientist"),
        ("We are looking for a Frontend Developer with React skills.", "Frontend Developer"),
    ],
)
def test_title_extraction(text, title):
    assert extract_job_title(text) == title


@pytest.mark.parametrize(
    "text",
    ["About us\nWe build things.", "Requirements:\n- React", "We are looking for someone great.", "Join our amazing team!"],
)
def test_title_not_guessed(text):
    assert extract_job_title(text) is None


def test_job_details():
    text = "Location: Bengaluru, India (Hybrid)\nEmployment Type: Full-time\n\nRequirements:\n- Go"
    r = extract_job_requirements(text)
    assert (r.location, r.employmentType, r.workMode) == ("Bengaluru, India (Hybrid)", "Full-time", "Hybrid")
    # Detail lines are not requirement content.
    assert r.requiredSkills == ["Go"]


def test_job_details_from_explicit_phrases_only():
    r = extract_job_requirements("This is a fully remote, full-time position.\nRequirements:\n- Go")
    assert (r.location, r.employmentType, r.workMode) == (None, "Full-time", "Remote")
    assert extract_job_requirements("We value remote collaboration.").workMode is None


# --- False positives ------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "We offer a 3-year growth opportunity.",
        "Benefits\n- 2 years of paid tuition\n- 401k with 3 year vesting",
        "About us\nWe have 10 years of experience building fintech products.",
        "Our company was founded 15 years ago.",
        "Candidates must be 18 years old or above.",
        "This is a 2 year contract role.",
    ],
)
def test_no_experience_requirement_invented(text):
    assert extract_job_requirements(text).experienceRequirements == []


def test_experience_with_javascript_is_useful_is_not_mandatory():
    r = extract_job_requirements("Experience with JavaScript is useful.")
    assert r.requiredSkills == [] and r.preferredSkills == ["JavaScript"]


def test_unknown_or_missing_sections_fabricate_nothing():
    r = extract_job_requirements("Come work with us! We are a friendly team in a sunny office.")
    assert r.model_dump() == {
        "jobTitle": None,
        "location": None,
        "employmentType": None,
        "workMode": None,
        "requiredSkills": [],
        "preferredSkills": [],
        "mentionedSkills": [],
        "experienceRequirements": [],
        "educationRequirements": [],
        "responsibilities": [],
    }


# --- Realistic job descriptions ------------------------------------------

BACKEND_JD = """Senior Backend Engineer
Location: Bengaluru, India (Hybrid)
Employment Type: Full-time

About us
We have 10 years of experience building fintech products. We offer a 3-year growth opportunity.
Our stack: Go, Kafka, PostgreSQL, Docker.

What you'll do
- Build scalable APIs in Node.js
- Review code and mentor engineers

What you'll need
- 3-5 years of experience with Node.js and TypeScript
- Strong knowledge of SQL databases like MySQL or Postgres
- Experience with JavaScript is useful.
- Must have Git experience; Kubernetes is a plus
- Minimum 2 years working with AWS
- BS/MS in Computer Science or equivalent experience

Bonus: GraphQL, Redis

Benefits
- Health insurance
- Learning budget
"""

DATA_JD = """Data Scientist (Full-time, Remote)

The role
You will design machine learning models and present insights to stakeholders.

Qualifications
• Master's degree in Statistics, Mathematics or a related field
• 2+ yrs of hands-on experience with Python, Pandas and scikit-learn
• Strong SQL skills

Preferred Qualifications
• Ph.D. in Machine Learning
• Experience with TensorFlow or PyTorch
• Familiarity with AWS is a plus

Work Mode: Remote
"""

INDIA_JD = """Job Title: Java Developer
Job Type: Contract

Roles and Responsibilities:
1. Develop Spring Boot microservices.
2. Write unit tests and participate in code reviews.

Eligibility Criteria:
- B.E./B.Tech/MCA in Computer Science or IT
- 1-3 years of experience in Java and Spring Boot
- Good to have: Angular, Jenkins and CI/CD exposure
"""


def test_realistic_backend_jd():
    r = extract_job_requirements(BACKEND_JD, provided_title="Backend Engineer")
    assert r.jobTitle == "Backend Engineer"
    assert (r.location, r.employmentType, r.workMode) == ("Bengaluru, India (Hybrid)", "Full-time", "Hybrid")
    assert r.requiredSkills == ["Node.js", "TypeScript", "MySQL", "PostgreSQL", "Git", "AWS"]
    assert r.preferredSkills == ["JavaScript", "Kubernetes", "GraphQL", "Redis"]
    assert r.mentionedSkills == ["Go", "Docker"]
    assert years(r.experienceRequirements) == [(3, 5, ["Node.js", "TypeScript"]), (2, None, ["AWS"])]
    assert [(e.degree, e.fields) for e in r.educationRequirements] == [("BS/MS", ["Computer Science"])]
    assert r.responsibilities == ["Build scalable APIs in Node.js", "Review code and mentor engineers"]


def test_realistic_data_science_jd():
    r = extract_job_requirements(DATA_JD)
    assert r.jobTitle == "Data Scientist"
    assert (r.employmentType, r.workMode) == (None, "Remote")
    assert r.requiredSkills == ["Python", "Pandas", "Scikit-learn"]
    assert r.preferredSkills == ["Machine Learning", "TensorFlow", "PyTorch", "AWS"]
    assert years(r.experienceRequirements) == [(2, None, ["Python", "Pandas", "Scikit-learn"])]
    assert [(e.degree, e.fields, e.preferred) for e in r.educationRequirements] == [
        ("Master's degree", ["Statistics", "Mathematics"], False),
        ("Ph.D", ["Machine Learning"], True),
    ]
    assert r.responsibilities == ["You will design machine learning models and present insights to stakeholders."]


def test_realistic_numbered_jd():
    r = extract_job_requirements(INDIA_JD)
    assert (r.jobTitle, r.employmentType) == ("Java Developer", "Contract")
    assert r.responsibilities == [
        "Develop Spring Boot microservices.",
        "Write unit tests and participate in code reviews.",
    ]
    assert r.requiredSkills == ["Java", "Spring Boot"]
    assert r.preferredSkills == ["Angular", "CI/CD"]
    assert years(r.experienceRequirements) == [(1, 3, ["Java", "Spring Boot"])]
    assert [(e.degree, e.fields) for e in r.educationRequirements] == [("B.E./B.Tech/MCA", ["Computer Science", "IT"])]


def test_large_input_is_fast():
    text = ("Requirements:\n" + "- 3+ years of experience with React, Node.js and AWS; Docker is a plus\n" * 600)[:50_000]
    started = time.perf_counter()
    response = client.post(URL, json={"job_description_id": "1", "text": text})
    assert response.status_code == 200
    assert time.perf_counter() - started < 5


# --- API endpoint ---------------------------------------------------------


def test_endpoint_contract():
    response = client.post(URL, json={"job_description_id": "123", "text": SPEC_EXAMPLE, "job_title": "  Frontend Dev  "})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["message"] == "Job requirements extracted successfully"
    assert body["data"]["jobDescriptionId"] == "123"
    requirements = body["data"]["requirements"]
    assert requirements["jobTitle"] == "Frontend Dev"
    assert requirements["requiredSkills"] == ["React", "TypeScript", "JavaScript", "Git"]
    assert requirements["experienceRequirements"][0]["minimumYears"] == 2
    assert requirements["experienceRequirements"][0]["maximumYears"] is None


def test_endpoint_preprocesses_raw_text():
    response = client.post(URL, json={"job_description_id": "1", "text": "Requirements:\r\n\r\n\r\n-  React​"})
    assert response.json()["data"]["requirements"]["requiredSkills"] == ["React"]


@pytest.mark.parametrize("text", ["", "   ", "\n\t", "​﻿"])
def test_endpoint_rejects_empty_text(text):
    response = client.post(URL, json={"job_description_id": "1", "text": text})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EMPTY_JOB_DESCRIPTION_TEXT"


def test_endpoint_rejects_oversized_text():
    response = client.post(URL, json={"job_description_id": "1", "text": "a" * 50_001})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "JOB_DESCRIPTION_TEXT_TOO_LARGE"


@pytest.mark.parametrize(
    "payload",
    [{"text": "x"}, {"job_description_id": "1"}, {"job_description_id": "1", "text": "x", "job_title": "t" * 201}],
)
def test_endpoint_rejects_invalid_payloads(payload):
    response = client.post(URL, json=payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_internal_errors_are_not_exposed(monkeypatch):
    def explode(text, provided_title=None):
        raise RuntimeError("secret /srv/path hr@acme.example")

    monkeypatch.setattr("app.services.job_requirement_extractor.extract_job_requirements", explode)
    response = client.post(URL, json={"job_description_id": "1", "text": "Hiring"})
    assert response.status_code == 500
    assert response.json() == {
        "success": False,
        "message": "Job requirement extraction failed",
        "error": {"code": "JOB_REQUIREMENT_EXTRACTION_FAILED", "details": None},
    }
    assert "secret" not in response.text


def test_endpoint_requires_internal_api_key_when_configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    payload = {"job_description_id": "1", "text": "Hiring"}
    assert client.post(URL, json=payload).status_code == 401
    assert client.post(URL, json=payload, headers={"X-Internal-API-Key": "test-key"}).status_code == 200
