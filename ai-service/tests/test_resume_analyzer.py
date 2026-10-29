import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.certification_analyzer import analyze_certifications
from app.services.education_analyzer import analyze_education
from app.services.experience_analyzer import analyze_experience
from app.services.personal_info_extractor import extract_personal_info
from app.services.project_analyzer import analyze_projects
from app.services.resume_analyzer import analyze_resume
from app.services.skill_extractor import extract_skills
from app.utils.dates import find_date_range

client = TestClient(app)

URL = "/api/resume/analyze"


def without_raw(entries) -> list[dict]:
    return [entry.model_dump(exclude={"rawText"}) for entry in entries]


# --- Dates ----------------------------------------------------------------


@pytest.mark.parametrize(
    "text, start, end, current",
    [
        ("Jan 2025 - Present", "Jan 2025", None, True),
        ("January 2025 – Current", "January 2025", None, True),
        ("01/2025 - 06/2025", "01/2025", "06/2025", False),
        ("2019 — 2021", "2019", "2021", False),
        ("Sept. 2021 to Dec 2022", "Sept. 2021", "Dec 2022", False),
        ("March 2017 till date", "March 2017", None, True),
        ("Graduated 2020", "2020", None, False),
    ],
)
def test_date_formats(text, start, end, current):
    dates = find_date_range(text)
    assert (dates.start, dates.end, dates.is_current) == (start, end, current)


@pytest.mark.parametrize("text", ["Reduced costs by 20%", "Served 12025 users", "Room 101", "Q2025"])
def test_no_dates_invented(text):
    assert find_date_range(text) is None


# --- Personal information -------------------------------------------------


def test_personal_information_detected():
    header = (
        "JOHN DOE\n"
        "Software Engineer\n"
        "Chennai, India | john.doe@example.com | +91 98765 43210\n"
        "https://www.linkedin.com/in/john-doe-123/ | https://github.com/johndoe | https://johndoe.dev"
    )
    assert extract_personal_info(header).model_dump() == {
        "name": "John Doe",
        "email": "john.doe@example.com",
        "phone": "+91 98765 43210",
        "location": "Chennai, India",
        "linkedin": "https://www.linkedin.com/in/john-doe-123",
        "github": "https://github.com/johndoe",
        "portfolio": "https://johndoe.dev",
    }


@pytest.mark.parametrize(
    "phone",
    ["+1 (555) 123-4567", "(555) 123-4567", "555.123.4567", "+44 20 7946 0958", "9876543210", "+91-98765-43210"],
)
def test_common_phone_formats(phone):
    assert extract_personal_info(f"Jane Roe\nPhone: {phone}").phone == phone


def test_missing_personal_information_is_null():
    info = extract_personal_info("Experienced developer\nWorked on many things")
    assert info.model_dump() == {
        "name": None,
        "email": None,
        "phone": None,
        "location": None,
        "linkedin": None,
        "github": None,
        "portfolio": None,
    }


@pytest.mark.parametrize(
    "header",
    [
        "not-an-email@\n2016 - 2020",  # invalid email, year range is not a phone
        "Worked 2020 2021 2022 2023",  # a run of years is not a phone
        "john..doe@example.com",  # consecutive dots
        "Call 12345",  # too few digits for a phone
        "Studied at B.Tech College",  # "B.Tech" is not a portfolio domain
    ],
)
def test_invalid_contact_details_are_not_guessed(header):
    info = extract_personal_info(header)
    assert info.email is None and info.phone is None and info.portfolio is None


def test_name_is_not_guessed_from_titles_or_headings():
    assert extract_personal_info("Senior Software Engineer\nABC Technologies").name is None
    assert extract_personal_info("CURRICULUM VITAE\nMaria Garcia").name == "Maria Garcia"
    assert extract_personal_info("Name: Arjun K. Mehta\nPune").name == "Arjun K. Mehta"


def test_contact_details_fall_back_to_the_rest_of_the_resume():
    info = extract_personal_info("Jane Roe", rest="Reach me at jane@roe.io or github.com/janeroe")
    assert info.email == "jane@roe.io"
    assert info.github == "github.com/janeroe"


def test_project_repository_is_not_taken_as_candidate_github():
    info = extract_personal_info("Jane Roe", rest="Code: github.com/someorg/some-repo")
    assert info.github is None


# --- Experience -----------------------------------------------------------


def test_spec_experience_example():
    section = (
        "Software Developer\nABC Technologies\nJan 2025 - Present\n\n"
        "- Developed REST APIs\n- Built React applications\n- Worked with MySQL"
    )
    assert without_raw(analyze_experience(section)) == [
        {
            "title": "Software Developer",
            "company": "ABC Technologies",
            "location": None,
            "startDate": "Jan 2025",
            "endDate": None,
            "isCurrent": True,
            "description": ["Developed REST APIs", "Built React applications", "Worked with MySQL"],
        }
    ]


def test_multiple_experience_entries_are_separated():
    section = (
        "Senior Software Engineer\nABC Technologies, Bengaluru\nJan 2023 - Present\n"
        "- Led a migration to microservices.\n- Mentored 3 developers.\n"
        "Software Engineer | XYZ Solutions | Jun 2020 - Dec 2022\n"
        "- Built REST APIs serving 1M+ requests/day.\n"
        "Google\nSoftware Engineering Intern\n05/2019 - 08/2019\n"
        "- Wrote tests\n  for the payments team"
    )
    entries = analyze_experience(section)
    assert [(e.title, e.company, e.location, e.startDate, e.endDate, e.isCurrent) for e in entries] == [
        ("Senior Software Engineer", "ABC Technologies", "Bengaluru", "Jan 2023", None, True),
        ("Software Engineer", "XYZ Solutions", None, "Jun 2020", "Dec 2022", False),
        ("Software Engineering Intern", "Google", None, "05/2019", "08/2019", False),
    ]
    assert entries[0].description == ["Led a migration to microservices.", "Mentored 3 developers."]
    # A wrapped bullet line is joined back into one item.
    assert entries[2].description == ["Wrote tests for the payments team"]


def test_experience_one_line_formats():
    section = (
        "Software Engineer at Microsoft (2019 – 2021)\nWorked on Azure.\n"
        "Google — Data Analyst — Remote — March 2017 to January 2019\nBuilt dashboards in 2018."
    )
    entries = analyze_experience(section)
    assert [(e.title, e.company, e.location, e.startDate, e.endDate) for e in entries] == [
        ("Software Engineer", "Microsoft", None, "2019", "2021"),
        ("Data Analyst", "Google", "Remote", "March 2017", "January 2019"),
    ]
    # A year inside a description does not start a new job.
    assert entries[1].description == ["Built dashboards in 2018."]


def test_ambiguous_experience_keeps_original_text():
    section = "Acme\nWidgets Unlimited\n2020 - 2021\nDid various things."
    entry = analyze_experience(section)[0]
    assert entry.title is None and entry.company is None
    assert entry.startDate == "2020" and entry.endDate == "2021"
    assert entry.rawText == section


def test_experience_without_dates_is_not_guessed():
    entries = analyze_experience("Freelance web work for local businesses.\nBuilt sites.")
    assert len(entries) == 1
    assert entries[0].title is None and entries[0].startDate is None
    assert entries[0].rawText == "Freelance web work for local businesses.\nBuilt sites."


# --- Education ------------------------------------------------------------


def test_spec_education_example():
    section = "B.Tech Computer Science\nXYZ University\n2022 - 2026\n8.4 CGPA"
    assert without_raw(analyze_education(section)) == [
        {
            "degree": "B.Tech",
            "field": "Computer Science",
            "institution": "XYZ University",
            "startDate": "2022",
            "endDate": "2026",
            "isCurrent": False,
            "grade": "8.4 CGPA",
        }
    ]


@pytest.mark.parametrize(
    "line, degree, field",
    [
        ("B.E. in Mechanical Engineering, ABC College, 2018", "B.E.", "Mechanical Engineering"),
        ("B.Sc Physics, ABC College, 2018", "B.Sc", "Physics"),
        ("BCA, ABC College, 2018", "BCA", None),
        ("M.Tech (Data Science), ABC Institute, 2018", "M.Tech", "Data Science"),
        ("M.E. Structural Engineering, ABC College, 2018", "M.E.", "Structural Engineering"),
        ("MSc Chemistry - ABC University - 2018", "MSc", "Chemistry"),
        ("MCA, ABC University, 2018", "MCA", None),
        ("MBA in Finance, ABC School of Business, 2018", "MBA", "Finance"),
        ("Ph.D. in Machine Learning, ABC University, 2018", "Ph.D", "Machine Learning"),
        ("Bachelor of Science in Mathematics, ABC University, 2018", "Bachelor of Science", "Mathematics"),
        ("Bachelor of Computer Science, ABC University, 2018", "Bachelor of Computer Science", None),
        ("Diploma in Civil Engineering, ABC Polytechnic, 2018", "Diploma", "Civil Engineering"),
    ],
)
def test_degree_names(line, degree, field):
    entry = analyze_education(line)[0]
    assert (entry.degree, entry.field, entry.endDate) == (degree, field, "2018")
    assert entry.institution is not None and "ABC" in entry.institution


def test_multiple_education_entries_and_grades():
    section = (
        "M.Sc. Statistics — University of Madras (2022 – 2024)\n"
        "B.Sc. Mathematics — Loyola College (2019 – 2022) | GPA 3.8/4.0\n"
        "Higher Secondary (XII), ABC Public School, 2019, 92%"
    )
    assert [(e.degree, e.field, e.institution, e.startDate, e.endDate, e.grade) for e in analyze_education(section)] == [
        ("M.Sc", "Statistics", "University of Madras", "2022", "2024", None),
        ("B.Sc", "Mathematics", "Loyola College", "2019", "2022", "GPA 3.8/4.0"),
        ("Higher Secondary", None, "ABC Public School", None, "2019", "92%"),
    ]


def test_institution_without_keyword_next_to_degree():
    entries = analyze_education("B.E. (Computer Engineering)\nStanford\n\nMBA\nIIM Ahmedabad")
    assert [(e.degree, e.field, e.institution) for e in entries] == [
        ("B.E.", "Computer Engineering", "Stanford"),
        ("MBA", None, "IIM Ahmedabad"),
    ]


def test_state_abbreviation_is_not_a_degree():
    entry = analyze_education("Harvard University, Cambridge, MA, 2019")[0]
    assert entry.degree is None
    assert entry.institution == "Harvard University, Cambridge"


def test_unknown_education_keeps_original_text():
    entry = analyze_education("Some notes about my school life\nnothing structured")[0]
    assert entry.degree is None and entry.institution is None
    assert entry.rawText == "Some notes about my school life\nnothing structured"


# --- Projects -------------------------------------------------------------


def test_projects_are_separated_with_technologies():
    section = (
        "AI Resume Analyzer (Python, FastAPI, React)   Jan 2025\n"
        "- Built a resume analysis platform\n"
        "- Implemented skill extraction\n"
        "Tech Stack: Python, FastAPI, React, MySQL\n"
        "github.com/priya/resume-analyzer\n\n"
        "Weather App | React, OpenWeather API\n"
        "Built a weather dashboard using\n"
        "React and Chart.js.\n"
        "Portfolio Site\n"
        "Personal site built with Next.js and Tailwind.\n"
        "Live: https://priya.dev"
    )
    assert without_raw(analyze_projects(section)) == [
        {
            "name": "AI Resume Analyzer",
            "description": ["Built a resume analysis platform", "Implemented skill extraction"],
            "technologies": ["Python", "React", "FastAPI", "MySQL"],
            "url": "github.com/priya/resume-analyzer",
        },
        {
            "name": "Weather App",
            "description": ["Built a weather dashboard using React and Chart.js."],
            "technologies": ["React"],
            "url": None,
        },
        {
            "name": "Portfolio Site",
            "description": ["Personal site built with Next.js and Tailwind."],
            "technologies": ["Next.js", "Tailwind CSS"],
            "url": "https://priya.dev",
        },
    ]


def test_project_title_followed_by_paragraph_after_blank_line():
    projects = analyze_projects("AI Resume Analyzer\n\nBuilt a resume analysis platform using\nNext.js and FastAPI.")
    assert len(projects) == 1
    assert projects[0].name == "AI Resume Analyzer"
    assert projects[0].description == ["Built a resume analysis platform using Next.js and FastAPI."]


def test_project_technologies_use_the_skill_extractor():
    text = "Chat App\nBuilt with ReactJS, NodeJS and Mongo."
    expected = [name for names in extract_skills(text).values() for name in names]
    assert analyze_projects(text)[0].technologies == expected == ["React", "Node.js", "MongoDB"]


# --- Certifications -------------------------------------------------------


def test_certifications_detected():
    section = (
        "AWS Certified Cloud Practitioner\n"
        "AWS Certified Cloud Practitioner - Amazon Web Services - 2026\n"
        "- AWS Certified Developer - Associate (2023)\n"
        "Deep Learning Specialization | Coursera | Jan 2024\n"
        "Machine Learning, issued by Stanford Online, 2022\n"
        "Credential ID ABC123\n"
        "Certified Kubernetes Administrator (CKA) from the Linux Foundation\n"
        "Meta Front-End Developer Certificate (Coursera), March 2023"
    )
    assert [c.model_dump() for c in analyze_certifications(section)] == [
        {"name": "AWS Certified Cloud Practitioner", "issuer": None, "date": None},
        {"name": "AWS Certified Cloud Practitioner", "issuer": "Amazon Web Services", "date": "2026"},
        {"name": "AWS Certified Developer - Associate", "issuer": None, "date": "2023"},
        {"name": "Deep Learning Specialization", "issuer": "Coursera", "date": "Jan 2024"},
        {"name": "Machine Learning", "issuer": "Stanford Online", "date": "2022"},
        {"name": "Certified Kubernetes Administrator (CKA)", "issuer": "Linux Foundation", "date": None},
        {"name": "Meta Front-End Developer Certificate", "issuer": "Coursera", "date": "March 2023"},
    ]


def test_issuer_is_not_inferred_from_the_name():
    [cert] = analyze_certifications("Google Data Analytics Professional Certificate")
    assert cert.issuer is None


# --- Full analysis --------------------------------------------------------

COMPLETE_RESUME = """PRIYA SHARMA
Full Stack Developer
Bengaluru, India | priya.sharma@example.com | +91 98765 43210
linkedin.com/in/priyasharma | github.com/priyasharma | priya.dev

PROFESSIONAL SUMMARY
Full stack developer with 4+ years of experience building scalable web applications.

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

Software Engineer | XYZ Solutions | Jun 2020 - Dec 2022
- Built REST APIs serving 1M+ requests/day.

PROJECTS
AI Resume Analyzer
- Built a resume analysis platform with Next.js, Express and FastAPI.
- Implemented skill extraction.

Weather App | React, Chart.js
Built a weather dashboard.

EDUCATION
B.Tech in Computer Science
XYZ University, 2016 - 2020 | CGPA: 8.7/10

CERTIFICATIONS
AWS Certified Developer - Associate (2023)
Deep Learning Specialization | Coursera | Jan 2024

ACHIEVEMENTS
- Winner, Smart India Hackathon 2019
- Dean's list

LANGUAGES
English, Hindi (Native), Kannada

Hobbies
Chess, cycling

PUBLICATIONS
Paper on scalable APIs, 2022

REFERENCES
Dr. Rao, rao@xyz.edu, +91 99999 88888
"""


def test_complete_resume_analysis():
    resume, metadata = analyze_resume(COMPLETE_RESUME)

    assert resume.personalInformation.model_dump() == {
        "name": "Priya Sharma",
        "email": "priya.sharma@example.com",
        "phone": "+91 98765 43210",
        "location": "Bengaluru, India",
        "linkedin": "linkedin.com/in/priyasharma",
        "github": "github.com/priyasharma",
        "portfolio": "priya.dev",
    }
    assert resume.summary.startswith("Full stack developer with 4+ years")
    assert [(e.title, e.company) for e in resume.experience] == [
        ("Senior Software Engineer", "ABC Technologies"),
        ("Software Engineer", "XYZ Solutions"),
    ]
    assert [(e.degree, e.field, e.institution, e.grade) for e in resume.education] == [
        ("B.Tech", "Computer Science", "XYZ University", "CGPA: 8.7/10")
    ]
    assert [p.name for p in resume.projects] == ["AI Resume Analyzer", "Weather App"]
    assert [c.name for c in resume.certifications] == [
        "AWS Certified Developer - Associate",
        "Deep Learning Specialization",
    ]
    assert resume.achievements == ["Winner, Smart India Hackathon 2019", "Dean's list"]
    assert resume.languages == ["English", "Hindi (Native)", "Kannada"]
    assert resume.interests == ["Chess", "cycling"]
    assert resume.otherSections == {"publications": "Paper on scalable APIs, 2022"}
    # Skills come straight from the Step 4B extractor.
    assert resume.skills == extract_skills(COMPLETE_RESUME)
    assert metadata.model_dump() == {
        "totalSkills": sum(len(v) for v in resume.skills.values()),
        "totalExperienceEntries": 2,
        "totalEducationEntries": 1,
        "totalProjects": 2,
        "totalCertifications": 2,
    }


def test_references_contact_details_are_never_used():
    resume, _ = analyze_resume("Jane Roe\n\nSKILLS\nPython\n\nREFERENCES\nDr. Rao, rao@xyz.edu, +91 99999 88888")
    assert resume.personalInformation.email is None
    assert resume.personalInformation.phone is None


def test_resume_without_headings():
    text = "Jane Roe\njane@roe.io\nPython developer who likes React."
    resume, metadata = analyze_resume(text)
    assert resume.personalInformation.name == "Jane Roe"
    assert resume.personalInformation.email == "jane@roe.io"
    assert resume.experience == [] and resume.education == [] and resume.projects == []
    assert metadata.totalSkills == 2


MALFORMED_INPUTS = [
    "a",
    "- - - - -\n• • •\n* * *",
    "EXPERIENCE\n\n\nEDUCATION\n\nPROJECTS",
    "EXPERIENCE\n2020 - 2021\n2021 - 2022\n2022 - Present",
    "EDUCATION\n(((((\n)))))\nB.Tech B.Tech B.Tech",
    "CERTIFICATIONS\n| | | |\n()\n-- 2020 --",
    "PROJECTS\nhttp://\nwww.\n:::",
    "📄📄📄\n日本語のテキスト\nمرحبا\n🙂 SKILLS 🙂",
    "EXPERIENCE\n" + "Engineer at Company Jan 2020 - Present\n" * 500,
]


@pytest.mark.parametrize("text", MALFORMED_INPUTS, ids=range(len(MALFORMED_INPUTS)))
def test_malformed_resumes_do_not_crash(text):
    response = client.post(URL, json={"resume_id": "1", "text": text})
    assert response.status_code == 200
    assert response.json()["success"] is True


@pytest.mark.parametrize(
    "text",
    [
        "a" * 100_000,
        "1" * 100_000,
        ("a" * 60 + "@") * 1_600,
        "EXPERIENCE\n" + "- x\n" * 24_000,
        "PROJECTS\n" + ("Title\nsentence.\n" * 6_000),
    ],
    ids=["letters", "digits", "at-signs", "bullets", "projects"],
)
def test_large_adversarial_input_is_fast(text):
    started = time.perf_counter()
    response = client.post(URL, json={"resume_id": "1", "text": text})
    assert response.status_code == 200
    assert time.perf_counter() - started < 5


# --- API endpoint ---------------------------------------------------------


def test_endpoint_response_contract():
    response = client.post(URL, json={"resume_id": "123", "text": COMPLETE_RESUME})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["message"] == "Resume analyzed successfully"
    assert body["data"]["resumeId"] == "123"
    assert set(body["data"]["resume"]) == {
        "personalInformation",
        "summary",
        "experience",
        "education",
        "projects",
        "skills",
        "certifications",
        "achievements",
        "languages",
        "interests",
        "otherSections",
    }
    assert set(body["data"]["metadata"]) == {
        "totalSkills",
        "totalExperienceEntries",
        "totalEducationEntries",
        "totalProjects",
        "totalCertifications",
    }
    assert body["data"]["resume"]["experience"][0]["rawText"].startswith("Senior Software Engineer")


@pytest.mark.parametrize("text", ["", "   ", "\n\t\r\n", "​﻿"])
def test_endpoint_rejects_empty_text(text):
    response = client.post(URL, json={"resume_id": "1", "text": text})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EMPTY_RESUME_TEXT"


@pytest.mark.parametrize("payload", [{"resume_id": "1"}, {"resume_id": "1", "text": 42}, {"text": "hi"}])
def test_endpoint_rejects_invalid_payloads(payload):
    response = client.post(URL, json=payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_endpoint_rejects_oversized_text():
    response = client.post(URL, json={"resume_id": "1", "text": "a" * 100_001})
    assert response.status_code == 413


def test_internal_errors_are_not_exposed(monkeypatch):
    def explode(text):
        raise RuntimeError("secret /srv/app/path and resume text john@example.com")

    monkeypatch.setattr("app.services.resume_analyzer.extract_sections", explode)
    response = client.post(URL, json={"resume_id": "1", "text": "john@example.com"})
    assert response.status_code == 500
    assert response.json() == {
        "success": False,
        "message": "Resume analysis failed",
        "error": {"code": "RESUME_ANALYSIS_FAILED", "details": None},
    }
    assert "secret" not in response.text and "Traceback" not in response.text


def test_endpoint_requires_internal_api_key_when_configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    payload = {"resume_id": "1", "text": "Python"}
    assert client.post(URL, json=payload).status_code == 401
    assert client.post(URL, json=payload, headers={"X-Internal-API-Key": "test-key"}).status_code == 200
