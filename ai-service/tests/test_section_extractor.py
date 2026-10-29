import pytest
from fastapi.testclient import TestClient

from app.data.sections import OTHER_SECTION_HEADINGS, SECTION_ALIASES
from app.main import app
from app.models.resume import ResumeSections
from app.services.section_extractor import SectionMatcher, extract_sections

client = TestClient(app)

URL = "/api/resume/extract-sections"


def sections(text: str) -> dict:
    """Extracted sections without the sections that were not found."""
    return extract_sections(text).model_dump(exclude_none=True)


# --- Dictionary integrity -------------------------------------------------


def test_dictionary_loads_without_conflicts():
    SectionMatcher(SECTION_ALIASES, OTHER_SECTION_HEADINGS)


def test_every_canonical_section_has_a_schema_field():
    fields = set(ResumeSections.model_fields) - {"other_sections"}
    assert set(SECTION_ALIASES) == fields


def test_duplicate_heading_is_rejected():
    with pytest.raises(ValueError, match="more than once"):
        SectionMatcher({"skills": ["Skills"], "summary": ["skills"]}, [])


def test_heading_in_both_known_and_other_is_rejected():
    with pytest.raises(ValueError, match="more than once"):
        SectionMatcher({"skills": ["skills"]}, ["skills"])


def test_dictionary_is_extensible():
    matcher = SectionMatcher({"skills": ["skills"]}, ["open source"])
    assert matcher.match("Open Source:") == (None, "open source")


# --- Heading detection ----------------------------------------------------


@pytest.mark.parametrize(
    "line, expected",
    [
        ("SKILLS", "skills"),
        ("Skills", "skills"),
        ("Technical Skills", "skills"),
        ("TECHNICAL SKILLS:", "skills"),
        ("Skills:", "skills"),
        ("Core Skills", "skills"),
        ("Professional Experience", "experience"),
        ("WORK EXPERIENCE", "experience"),
        ("Employment History", "experience"),
        ("Academic Background", "education"),
        ("Educational Qualifications", "education"),
        ("Professional Summary", "summary"),
        ("Profile", "summary"),
        ("Career Summary", "summary"),
        ("Career Objective", "summary"),
        ("Certificates", "certifications"),
        ("Certifications & Courses", "certifications"),
        ("Awards", "achievements"),
        ("Honors and Awards", "achievements"),
        ("Personal Details", "personal_information"),
        ("Hobbies", "interests"),
        ("Languages", "languages"),
        ("References", "references"),
        ("  EDUCATION  ", "education"),
        ("## Projects", "projects"),
        ("**Projects**", "projects"),
        ("— EDUCATION —", "education"),
        ("SKILLS -", "skills"),
        ("S K I L L S", "skills"),
        ("W O R K E X P E R I E N C E", "experience"),
    ],
)
def test_headings_are_recognised(line, expected):
    match = SectionMatcher(SECTION_ALIASES, OTHER_SECTION_HEADINGS).match(line)
    assert match is not None and match[0] == expected


@pytest.mark.parametrize(
    "line",
    [
        "I developed technical skills in Python and React.",
        "I have strong technical skills in Python and React.",
        "Skills: Python, React, SQL",  # label with inline content, not a heading line
        "skills",  # lowercase fragment of a wrapped sentence
        "Experience.",
        "Education, training and mentoring",
        "• Leadership",  # bullet item inside a section
        "Software Developer",
        "",
    ],
)
def test_non_headings_are_ignored(line):
    assert SectionMatcher(SECTION_ALIASES, OTHER_SECTION_HEADINGS).match(line) is None


# --- Extraction and boundaries --------------------------------------------

SPEC_EXAMPLE = """JOHN DOE

PROFESSIONAL SUMMARY

Software developer with experience building web applications.

TECHNICAL SKILLS

Python
React
Node.js
MySQL

WORK EXPERIENCE

Software Developer
ABC Technologies
2025 - Present

EDUCATION

B.Tech Computer Science
XYZ University"""


def test_basic_section_extraction():
    assert sections(SPEC_EXAMPLE) == {
        "personal_information": "JOHN DOE",
        "summary": "Software developer with experience building web applications.",
        "skills": "Python\nReact\nNode.js\nMySQL",
        "experience": "Software Developer\nABC Technologies\n2025 - Present",
        "education": "B.Tech Computer Science\nXYZ University",
        "other_sections": {},
    }


def test_content_is_not_mixed_between_sections():
    text = (
        "EDUCATION\nB.Tech Computer Science\nXYZ University\n\n"
        "PROJECTS\nAI Resume Analyzer\nBuilt a resume analysis platform..."
    )
    assert sections(text) == {
        "education": "B.Tech Computer Science\nXYZ University",
        "projects": "AI Resume Analyzer\nBuilt a resume analysis platform...",
        "other_sections": {},
    }


def test_headings_with_colons():
    text = "Skills:\nPython\nEducation:\nBSc Physics\nProjects:\nWeather app"
    assert sections(text) == {
        "skills": "Python",
        "education": "BSc Physics",
        "projects": "Weather app",
        "other_sections": {},
    }


def test_duplicate_sections_are_combined_in_order():
    text = "PROJECTS\n\nProject A...\n\nSKILLS\nGo\n\nPROJECTS\n\nProject B..."
    result = sections(text)
    assert result["projects"] == "Project A...\n\nProject B..."
    assert result["skills"] == "Go"


def test_aliases_of_the_same_section_are_combined():
    text = "Objective\nTo build things.\n\nProfessional Summary\nBuilder of things."
    assert sections(text)["summary"] == "To build things.\n\nBuilder of things."


def test_unknown_sections_go_to_other_sections():
    text = (
        "EXPERIENCE\nEngineer at Acme\n\n"
        "PUBLICATIONS\nPaper information...\n\n"
        "Volunteer Experience:\nFood bank coordinator\n\n"
        "EDUCATION\nMIT"
    )
    result = sections(text)
    assert result["other_sections"] == {
        "publications": "Paper information...",
        "volunteer experience": "Food bank coordinator",
    }
    # The unknown section ends at the next heading.
    assert result["education"] == "MIT"
    assert result["experience"] == "Engineer at Acme"


def test_heading_like_sentence_is_part_of_the_section():
    text = "SUMMARY\nI have strong technical skills in Python and React.\n\nEDUCATION\nBSc"
    assert sections(text) == {
        "summary": "I have strong technical skills in Python and React.",
        "education": "BSc",
        "other_sections": {},
    }


def test_wrapped_sentence_fragment_is_not_a_heading():
    text = "SUMMARY\nDeveloper who built strong technical\nskills in React and Node."
    assert sections(text)["summary"] == "Developer who built strong technical\nskills in React and Node."
    assert "skills" not in sections(text)


def test_text_without_headings_gives_no_sections():
    text = (
        "Jane Smith is a software engineer with five years of experience.\n"
        "She has technical skills in Python and a degree in computer science.\n"
        "Her projects include a weather app."
    )
    assert sections(text) == {"other_sections": {}}


def test_empty_sections_are_omitted():
    assert sections("SKILLS\n\n\nEDUCATION\nBSc") == {"education": "BSc", "other_sections": {}}


def test_formatting_is_preserved():
    text = (
        "EXPERIENCE\n"
        "Company Name\n"
        "Software Developer\n"
        "2024 - 2026\n"
        "- Developed APIs\n"
        "• Built React applications\n\n\n\n"
        "Second Company\n"
        "Intern | Jan 2023 – Jun 2023"
    )
    assert sections(text)["experience"] == (
        "Company Name\nSoftware Developer\n2024 - 2026\n- Developed APIs\n• Built React applications"
        "\n\nSecond Company\nIntern | Jan 2023 – Jun 2023"
    )


def test_bullet_items_matching_headings_stay_in_their_section():
    text = "ACHIEVEMENTS\n• Leadership\n• Dean's list\n\nEDUCATION\nBSc"
    assert sections(text)["achievements"] == "• Leadership\n• Dean's list"
    assert sections(text)["other_sections"] == {}


# --- Realistic resumes ----------------------------------------------------

FULL_STACK_RESUME = """PRIYA SHARMA
Full Stack Developer
priya.sharma@example.com | +91 98765 43210 | linkedin.com/in/priyasharma

PROFESSIONAL SUMMARY
Full stack developer with 4+ years of experience building scalable web
applications. I have strong technical skills in React, Node.js and MySQL.

TECHNICAL SKILLS:
Languages: JavaScript, TypeScript, Python
Frameworks: React, Next.js, Express.js
Databases: MySQL, MongoDB

WORK EXPERIENCE
Senior Software Engineer
ABC Technologies, Bengaluru
Jan 2023 - Present
- Led migration of a monolith to microservices, cutting deploy time by 60%.
- Mentored 3 junior developers.

Software Engineer
XYZ Solutions, Pune
Jun 2020 - Dec 2022
- Built REST APIs serving 1M+ requests/day.

PROJECTS
AI Resume Analyzer
Built a resume analysis platform with Next.js, Express and FastAPI.

EDUCATION
B.Tech in Computer Science
XYZ University, 2016 - 2020 | CGPA: 8.7/10

CERTIFICATIONS
AWS Certified Developer - Associate (2023)

ACHIEVEMENTS
Winner, Smart India Hackathon 2019
"""

GRADUATE_RESUME = """Rahul Verma
Chennai, India · rahul@example.com

Career Objective
Motivated graduate seeking an entry-level data analyst role.

Academic Background
M.Sc. Statistics — University of Madras (2022 – 2024)
B.Sc. Mathematics — Loyola College (2019 – 2022)

Technical Skills
Python (Pandas, NumPy), SQL, Excel, Tableau

Academic Projects
Customer churn prediction using logistic regression.

Certifications & Courses
Google Data Analytics Professional Certificate

Awards & Achievements
University rank holder, 2024

Publications
"Forecasting rainfall with ARIMA", Journal of Applied Stats, 2024

Languages
English, Tamil, Hindi

Hobbies
Chess, cycling

References
Available on request
"""

DESIGNER_RESUME = """## Maria Garcia

## Profile
Product designer focused on accessible interfaces.

## Experience
**Lead Designer**, Studio North (2021 – present)
* Redesigned onboarding, raising activation by 18%.

## Projects
Design system for a fintech app.

## Volunteering
Mentor at Women Who Design.

## Projects
Accessibility audit toolkit.

## Education
BFA Interaction Design, Parsons
"""


def test_full_stack_resume():
    result = sections(FULL_STACK_RESUME)
    assert set(result) == {
        "personal_information",
        "summary",
        "skills",
        "experience",
        "projects",
        "education",
        "certifications",
        "achievements",
        "other_sections",
    }
    assert result["personal_information"].startswith("PRIYA SHARMA\nFull Stack Developer\npriya.sharma@")
    # The heading-like sentence stays inside the summary.
    assert result["summary"].endswith("I have strong technical skills in React, Node.js and MySQL.")
    # Sub-labels inside the skills section do not start new sections.
    assert result["skills"] == (
        "Languages: JavaScript, TypeScript, Python\n"
        "Frameworks: React, Next.js, Express.js\n"
        "Databases: MySQL, MongoDB"
    )
    assert "ABC Technologies, Bengaluru\nJan 2023 - Present" in result["experience"]
    assert "XYZ Solutions, Pune" in result["experience"]
    assert result["education"] == "B.Tech in Computer Science\nXYZ University, 2016 - 2020 | CGPA: 8.7/10"
    assert result["certifications"] == "AWS Certified Developer - Associate (2023)"
    assert result["achievements"] == "Winner, Smart India Hackathon 2019"
    assert result["other_sections"] == {}


def test_graduate_resume_with_title_case_aliases():
    assert sections(GRADUATE_RESUME) == {
        "personal_information": "Rahul Verma\nChennai, India · rahul@example.com",
        "summary": "Motivated graduate seeking an entry-level data analyst role.",
        "education": (
            "M.Sc. Statistics — University of Madras (2022 – 2024)\n"
            "B.Sc. Mathematics — Loyola College (2019 – 2022)"
        ),
        "projects": "Customer churn prediction using logistic regression.",
        "skills": "Python (Pandas, NumPy), SQL, Excel, Tableau",
        "certifications": "Google Data Analytics Professional Certificate",
        "achievements": "University rank holder, 2024",
        "languages": "English, Tamil, Hindi",
        "interests": "Chess, cycling",
        "references": "Available on request",
        "other_sections": {"publications": '"Forecasting rainfall with ARIMA", Journal of Applied Stats, 2024'},
    }


def test_markdown_style_resume_with_repeated_and_unknown_sections():
    result = sections(DESIGNER_RESUME)
    # "## Maria Garcia" is not a known heading, so it stays in the header.
    assert result["personal_information"] == "## Maria Garcia"
    assert result["summary"] == "Product designer focused on accessible interfaces."
    assert result["experience"] == (
        "**Lead Designer**, Studio North (2021 – present)\n* Redesigned onboarding, raising activation by 18%."
    )
    assert result["projects"] == "Design system for a fintech app.\n\nAccessibility audit toolkit."
    assert result["other_sections"] == {"volunteering": "Mentor at Women Who Design."}
    assert result["education"] == "BFA Interaction Design, Parsons"


# --- API endpoint ---------------------------------------------------------


def test_endpoint_returns_sections():
    response = client.post(URL, json={"resume_id": "123", "text": SPEC_EXAMPLE})
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "message": "Resume sections extracted successfully",
        "data": {
            "resumeId": "123",
            "sections": {
                "personal_information": "JOHN DOE",
                "summary": "Software developer with experience building web applications.",
                "experience": "Software Developer\nABC Technologies\n2025 - Present",
                "education": "B.Tech Computer Science\nXYZ University",
                "skills": "Python\nReact\nNode.js\nMySQL",
                "other_sections": {},
            },
        },
    }


def test_endpoint_preprocesses_raw_text():
    raw = "  SKILLS:  \r\n\r\n\r\n\r\nPython\t\tReact  \r\nEDUCATION\r\nBSc"
    response = client.post(URL, json={"resume_id": "1", "text": raw})
    assert response.status_code == 200
    assert response.json()["data"]["sections"] == {
        "skills": "Python React",
        "education": "BSc",
        "other_sections": {},
    }


def test_endpoint_returns_no_sections_for_plain_text():
    response = client.post(URL, json={"resume_id": "1", "text": "Just a paragraph about me."})
    assert response.status_code == 200
    assert response.json()["data"] == {"resumeId": "1", "sections": {"other_sections": {}}}


@pytest.mark.parametrize("text", ["", "   ", "\n\t\r\n", "​﻿"])
def test_endpoint_rejects_empty_text(text):
    response = client.post(URL, json={"resume_id": "1", "text": text})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EMPTY_RESUME_TEXT"


def test_endpoint_rejects_missing_text():
    response = client.post(URL, json={"resume_id": "1"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_endpoint_rejects_oversized_text():
    response = client.post(URL, json={"resume_id": "1", "text": "a" * 100_001})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "RESUME_TEXT_TOO_LARGE"


def test_endpoint_requires_internal_api_key_when_configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    payload = {"resume_id": "1", "text": "SKILLS\nPython"}
    assert client.post(URL, json=payload).status_code == 401
    assert client.post(URL, json=payload, headers={"X-Internal-API-Key": "test-key"}).status_code == 200
