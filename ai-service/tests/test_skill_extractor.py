import pytest
from fastapi.testclient import TestClient

from app.data.skills import CASE_SENSITIVE_TERMS, SKILL_ALIASES, SKILLS
from app.main import app
from app.services.skill_extractor import SkillMatcher, extract_skills

client = TestClient(app)

URL = "/api/resume/extract-skills"


def flat(result: dict[str, list[str]]) -> set[str]:
    return {name for names in result.values() for name in names}


# --- Dictionary integrity -------------------------------------------------


def test_dictionary_loads_without_conflicts():
    SkillMatcher(SKILLS, SKILL_ALIASES, CASE_SENSITIVE_TERMS)


def test_duplicate_skill_across_categories_is_rejected():
    with pytest.raises(ValueError, match="more than one category"):
        SkillMatcher({"a": ["Python"], "b": ["Python"]}, {}, set())


def test_alias_to_unknown_skill_is_rejected():
    with pytest.raises(ValueError, match="unknown skill"):
        SkillMatcher({"a": ["Python"]}, {"Py": "Pythn"}, set())


def test_dictionary_is_extensible():
    matcher = SkillMatcher({"tools": ["Terraform"]}, {"TF": "Terraform"}, {"TF"})
    assert matcher.extract("Provisioned infra with TF") == {"tools": ["Terraform"]}


# --- Matching behaviour ---------------------------------------------------


def test_detects_basic_skills():
    text = "Experienced software developer with Python,\nReact, Node.js and MySQL experience."
    assert extract_skills(text) == {
        "programming_languages": ["Python"],
        "frontend": ["React"],
        "backend": ["Node.js"],
        "databases": ["MySQL"],
    }


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Built SPAs in ReactJS", "React"),
        ("Built SPAs in React.js", "React"),
        ("SSR with NextJS", "Next.js"),
        ("Wrote JS daily", "JavaScript"),
        ("Strictly typed TS code", "TypeScript"),
        ("APIs with Node and Express", "Node.js"),
        ("Stored data in Postgres", "PostgreSQL"),
        ("Stored data in Mongo", "MongoDB"),
        ("Deployed on GCP", "Google Cloud"),
        ("Managed K8s clusters", "Kubernetes"),
        ("Services written in Golang", "Go"),
        ("Built RESTful APIs", "REST API"),
        ("Built a model with sklearn", "Scikit-learn"),
        ("ASP.NET Core web apps", ".NET"),
    ],
)
def test_aliases_map_to_canonical_names(text, expected):
    assert expected in flat(extract_skills(text))


def test_java_is_not_detected_inside_javascript():
    assert flat(extract_skills("Frontend work in JavaScript and TypeScript")) == {"JavaScript", "TypeScript"}


def test_java_and_javascript_both_detected_when_both_present():
    assert {"Java", "JavaScript"} <= flat(extract_skills("Java, JavaScript"))


def test_c_family_is_distinguished():
    assert flat(extract_skills("C++ and C# developer")) == {"C++", "C#"}
    assert flat(extract_skills("Embedded C/C++")) == {"C", "C++"}


def test_js_suffix_is_not_detected_separately():
    # "js" inside "Node.js"/"Next.js" must not also produce JavaScript.
    assert flat(extract_skills("Node.js and Next.js")) == {"Node.js", "Next.js"}


def test_net_is_not_detected_inside_other_words():
    assert extract_skills("Worked on the internet and a dotnetwork") == {}


def test_ambiguous_words_need_exact_case():
    assert extract_skills("Ready to go the extra mile, grade c, express delivery, ml of water") == {}
    assert extract_skills("Go-to person for C-suite reporting") == {}
    assert flat(extract_skills("Go, C, Express, ML")) == {"Go", "C", "Express.js", "Machine Learning"}


def test_common_skills_match_case_insensitively():
    assert flat(extract_skills("python, DOCKER, kubernetes, Github")) == {"Python", "Docker", "Kubernetes", "GitHub"}


def test_multi_word_skills_match_across_line_breaks():
    assert flat(extract_skills("Machine\nLearning and Spring   Boot")) == {"Machine Learning", "Spring Boot"}


def test_skill_at_sentence_end_is_detected():
    assert flat(extract_skills("My main language is Python.")) == {"Python"}


def test_duplicate_mentions_give_one_canonical_skill():
    result = extract_skills("React, ReactJS, react, React.js, REACT")
    assert result == {"frontend": ["React"]}


def test_results_follow_dictionary_order():
    result = extract_skills("MySQL, Git, TypeScript, Python, React")
    assert list(result) == ["programming_languages", "frontend", "databases", "tools"]
    assert result["programming_languages"] == ["Python", "TypeScript"]


def test_no_known_skills_gives_empty_result():
    assert extract_skills("Enthusiastic team player who enjoys cooking and hiking.") == {}


# --- Realistic resumes ----------------------------------------------------

FULL_STACK_RESUME = """
JANE DOE
Full Stack Developer | jane@example.com | +1 555 0100

SUMMARY
Full stack engineer with 5 years building web apps using ReactJS, NextJS and Node.

SKILLS
Languages: JavaScript (ES6+), TypeScript, Python, SQL
Frontend: React, Next.js, Tailwind, HTML5, CSS3
Backend: Node.js, Express, REST APIs, GraphQL
Databases: MySQL, Postgres, Redis
DevOps: Docker, AWS (EC2, S3), CI/CD with GitHub Actions
Tools: Git, Jira, Postman

EXPERIENCE
Senior Developer, Acme Corp (2021 - Present)
- Migrated a monolith to microservices on Kubernetes.
- Reduced API latency by 40% using Redis caching.
"""

DATA_SCIENCE_RESUME = """
John Smith - Data Scientist

Experience with machine learning and deep learning, including NLP.
Built models in PyTorch and TensorFlow; data wrangling with pandas and numpy;
classical models with scikit-learn. Deployed on Google Cloud Platform.
Comfortable on Linux, versioning with Git and GitLab.
"""

NON_TECH_RESUME = """
Mary Major
Registered Nurse

Provided patient care in a busy emergency department. Coordinated with
doctors and families, and trained new staff members. Go-to person for
scheduling during the Spring rotation.
"""


def test_full_stack_resume():
    assert extract_skills(FULL_STACK_RESUME) == {
        "programming_languages": ["Python", "JavaScript", "TypeScript"],
        "frontend": ["React", "Next.js", "HTML", "CSS", "Tailwind CSS"],
        "backend": ["Node.js", "Express.js"],
        "databases": ["MySQL", "PostgreSQL", "Redis"],
        "cloud": ["AWS", "Docker", "Kubernetes"],
        "tools": ["Git", "GitHub", "Jira", "Postman"],
        "other": ["REST API", "GraphQL", "Microservices", "CI/CD"],
    }


def test_data_science_resume():
    assert extract_skills(DATA_SCIENCE_RESUME) == {
        "cloud": ["Google Cloud"],
        "tools": ["Git", "GitLab"],
        "ai_ml": [
            "Machine Learning",
            "Deep Learning",
            "NLP",
            "TensorFlow",
            "PyTorch",
            "Scikit-learn",
            "Pandas",
            "NumPy",
        ],
        "other": ["Linux"],
    }


def test_non_technical_resume_has_no_skills():
    assert extract_skills(NON_TECH_RESUME) == {}


# --- API endpoint ---------------------------------------------------------


def test_endpoint_returns_categorized_skills():
    response = client.post(
        URL, json={"resume_id": "123", "text": "Software developer skilled in Python, React and MySQL."}
    )
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "message": "Resume skills extracted successfully",
        "data": {
            "resumeId": "123",
            "skills": {
                "programming_languages": ["Python"],
                "frontend": ["React"],
                "databases": ["MySQL"],
            },
            "totalSkills": 3,
        },
    }


def test_endpoint_preprocesses_raw_text():
    # Zero-width spaces from PDF extraction would otherwise split "Py​thon".
    response = client.post(URL, json={"resume_id": "1", "text": "Py​thon\r\n\r\n\r\nDocker"})
    assert response.status_code == 200
    assert response.json()["data"]["skills"] == {"programming_languages": ["Python"], "cloud": ["Docker"]}


def test_endpoint_returns_empty_result_for_no_skills():
    response = client.post(URL, json={"resume_id": "1", "text": "I enjoy gardening."})
    assert response.status_code == 200
    assert response.json()["data"] == {"resumeId": "1", "skills": {}, "totalSkills": 0}


@pytest.mark.parametrize("text", ["", "   ", "\n\t", "​﻿"])
def test_endpoint_rejects_empty_text(text):
    response = client.post(URL, json={"resume_id": "1", "text": text})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EMPTY_RESUME_TEXT"


def test_endpoint_rejects_oversized_text():
    response = client.post(URL, json={"resume_id": "1", "text": "a" * 100_001})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "RESUME_TEXT_TOO_LARGE"


def test_endpoint_requires_internal_api_key_when_configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    payload = {"resume_id": "1", "text": "Python"}
    assert client.post(URL, json=payload).status_code == 401
    assert client.post(URL, json=payload, headers={"X-Internal-API-Key": "test-key"}).status_code == 200
