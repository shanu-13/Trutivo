import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.matching import SemanticJobInput, SemanticMatchRequest, SemanticResumeInput
from app.services import semantic_matcher
from app.services.embedding_service import EmbeddingModelUnavailable, EmbeddingService
from app.services.semantic_matcher import match_semantically, similarity_percentage
from app.services.semantic_text_builder import MAX_CHUNK_WORDS, build_job_text, build_resume_text, chunk_text
from tests.test_embedding_service import FakeModel

client = TestClient(app)
URL = "/api/matching/semantic"

RESUME = {
    "summary": "Frontend developer experienced in building responsive web applications.",
    "experience": [
        {
            "title": "Software Developer Intern",
            "company": "ABC Technologies",
            "description": ["Built React and Next.js applications.", "Developed REST APIs using Node.js and Express."],
        },
        {"rawText": "Freelance work, 2021"},
    ],
    "projects": [
        {"name": "AI Resume Analyzer", "description": ["Built a resume processing application"], "technologies": ["Python", "FastAPI"]}
    ],
    "skills": {"frontend": ["React", "Next.js"], "backend": ["Node.js", "Express.js"]},
    "education": [{"degree": "B.Tech", "field": "Computer Science", "institution": "XYZ University"}],
}
JOB = {
    "title": "Backend Developer",
    "description": "We build APIs.",
    "responsibilities": ["Develop REST APIs and backend services."],
    "requiredSkills": ["Node.js", "Express.js", "JavaScript", "MySQL"],
    "preferredSkills": ["Docker", "AWS"],
    "experienceRequirements": [{"text": "2+ years backend development"}],
    "educationRequirements": [{"text": "Bachelor's degree in Computer Science"}],
}


def request(resume=None, job=None) -> SemanticMatchRequest:
    return SemanticMatchRequest.model_validate(
        {"resume_id": "r1", "job_description_id": "j1", "resume": RESUME if resume is None else resume, "job": JOB if job is None else job}
    )


def fake_service() -> EmbeddingService:
    return EmbeddingService("sentence-transformers/all-MiniLM-L6-v2", loader=lambda name: FakeModel())


# --- Semantic text builder ------------------------------------------------


def test_resume_text_includes_professional_sections():
    text = build_resume_text(SemanticResumeInput.model_validate(RESUME))
    full = text.full()
    assert "Professional Summary:\nFrontend developer experienced" in full
    assert "Software Developer Intern at ABC Technologies\nBuilt React and Next.js applications." in text.experience
    assert "Freelance work, 2021" in text.experience  # unstructured entry keeps its text
    assert "AI Resume Analyzer\nBuilt a resume processing application\nTechnologies: Python, FastAPI" == text.projects
    assert text.skills == "React, Next.js, Node.js, Express.js"
    assert text.education == "B.Tech Computer Science, XYZ University"
    assert "{" not in full and "[" not in full  # plain text, not JSON


def test_resume_text_excludes_personal_data_ids_and_paths():
    resume = {
        **RESUME,
        "resumeId": "6f1c-resume-id",
        "userId": "user-123",
        "filePath": "/srv/uploads/resumes/6f1c.pdf",
        "personalInformation": {"name": "John Doe", "email": "john@example.com", "phone": "+91 98765 43210"},
        "token": "eyJhbGciOiJIUzI1NiJ9.secret",
        "password": "hunter2",
        "experience": [{"title": "Developer", "company": "ABC", "description": ["Built APIs"], "userId": "user-123"}],
    }
    full = build_resume_text(SemanticResumeInput.model_validate(resume)).full()
    for leaked in ("6f1c", "user-123", "/srv/uploads", "John Doe", "john@example.com", "98765", "eyJhbGci", "hunter2"):
        assert leaked not in full


def test_job_text_sections():
    text = build_job_text(SemanticJobInput.model_validate({**JOB, "userId": "u1", "id": "jd-9"}))
    full = text.full()
    for heading in ("Job Title:", "Responsibilities:", "Required Skills:", "Preferred Skills:", "Experience Requirements:", "Education Requirements:", "Description:"):
        assert heading in full
    assert "u1" not in full and "jd-9" not in full
    assert text.all_skills() == "Node.js, Express.js, JavaScript, MySQL, Docker, AWS"
    assert text.responsibilities_and_experience() == "Develop REST APIs and backend services.\n2+ years backend development"


def test_missing_sections_give_empty_text():
    text = build_resume_text(SemanticResumeInput.model_validate({"skills": ["React"]}))
    assert (text.summary, text.experience, text.projects, text.education) == ("", "", "", "")
    assert text.full() == "Skills:\nReact"


def test_chunking_keeps_all_content_within_the_limit():
    text = "\n".join(f"Line {i} " + "word " * 50 for i in range(10))
    chunks, truncated = chunk_text(text)
    assert not truncated
    assert all(len(chunk.split()) <= MAX_CHUNK_WORDS for chunk in chunks)
    assert " ".join(" ".join(chunks).split()) == " ".join(text.split())


def test_chunking_splits_a_single_huge_line():
    chunks, truncated = chunk_text("word " * 1000)
    assert len(chunks) == 9 and not truncated
    assert sum(len(c.split()) for c in chunks) == 1000


def test_chunking_reports_truncation_beyond_the_cap():
    chunks, truncated = chunk_text("word " * 1000, max_words=10, max_chunks=5)
    assert len(chunks) == 5 and truncated


# --- Semantic matcher (deterministic fake model) ---------------------------


def test_similarity_percentage_is_clamped():
    assert similarity_percentage(0.87421) == 87.42
    assert similarity_percentage(-0.3) == 0
    assert similarity_percentage(1.0000001) == 100
    assert similarity_percentage(None) is None


def test_all_components_calculated():
    result = match_semantically(request(), fake_service())
    for name in ("overallSemanticSimilarity", "experienceSemanticSimilarity", "projectSemanticSimilarity", "skillsSemanticSimilarity"):
        component = getattr(result, name)
        assert component.status == "calculated" and 0 <= component.similarity <= 100
    assert result.metadata.model_dump() == {"model": "sentence-transformers/all-MiniLM-L6-v2", "method": "cosine_similarity"}


def test_all_chunks_are_embedded_in_one_batch():
    model = FakeModel()
    match_semantically(request(), EmbeddingService("m", loader=lambda name: model))
    assert len(model.calls) == 1


@pytest.mark.parametrize(
    "missing, component",
    [("experience", "experienceSemanticSimilarity"), ("projects", "projectSemanticSimilarity"), ("skills", "skillsSemanticSimilarity")],
)
def test_missing_resume_sections_do_not_crash(missing, component):
    result = match_semantically(request(resume={**RESUME, missing: []}), fake_service())
    assert getattr(result, component).status == "not_available"
    assert getattr(result, component).similarity is None
    assert result.overallSemanticSimilarity.status == "calculated"


def test_missing_optional_resume_sections_do_not_crash():
    result = match_semantically(request(resume={"skills": ["Node.js"]}), fake_service())
    assert result.skillsSemanticSimilarity.status == "calculated"
    assert result.experienceSemanticSimilarity.reason == "The resume lists no work experience"


def test_sparse_job_does_not_crash():
    result = match_semantically(request(job={"title": "Backend Developer"}), fake_service())
    assert result.overallSemanticSimilarity.status == "calculated"
    assert result.skillsSemanticSimilarity.reason == "The job lists no skills"


@pytest.mark.parametrize(
    "resume, job, code",
    [
        ({}, JOB, "EMPTY_RESUME_CONTENT"),
        ({"summary": "   ", "experience": [{"description": [" "]}], "skills": []}, JOB, "EMPTY_RESUME_CONTENT"),
        (RESUME, {}, "EMPTY_JOB_CONTENT"),
        (RESUME, {"title": " ", "responsibilities": [""]}, "EMPTY_JOB_CONTENT"),
    ],
)
def test_empty_content_is_rejected(resume, job, code):
    response = client.post(URL, json={"resume_id": "r1", "job_description_id": "j1", "resume": resume, "job": job})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_unusable_embeddings_are_reported_not_scored():
    # The fake model gives a zero vector for text without letters.
    result = match_semantically(request(resume={"skills": ["123"]}), fake_service())
    assert result.skillsSemanticSimilarity.status == "not_available"
    assert result.skillsSemanticSimilarity.similarity is None


# --- API ------------------------------------------------------------------


def test_model_unavailable_returns_controlled_error(monkeypatch):
    def unavailable(payload, service=None):
        raise EmbeddingModelUnavailable("model failed at /home/user/.cache")

    monkeypatch.setattr("app.routes.matching.match_semantically", unavailable)
    response = client.post(URL, json={"resume_id": "r1", "job_description_id": "j1", "resume": RESUME, "job": JOB})
    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "message": "Semantic matching service is currently unavailable.",
        "error": {"code": "EMBEDDING_MODEL_UNAVAILABLE", "details": None},
    }
    assert ".cache" not in response.text


def test_unexpected_errors_are_not_exposed(monkeypatch):
    def explode(payload, service=None):
        raise RuntimeError("secret /srv/path")

    monkeypatch.setattr("app.routes.matching.match_semantically", explode)
    response = client.post(URL, json={"resume_id": "r1", "job_description_id": "j1", "resume": RESUME, "job": JOB})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "SEMANTIC_MATCHING_FAILED"
    assert "secret" not in response.text


def test_invalid_payload_rejected():
    response = client.post(URL, json={"resume_id": "r1", "resume": RESUME, "job": JOB})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_internal_api_key_enforced(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    assert client.post(URL, json={"resume_id": "r1", "job_description_id": "j1", "resume": RESUME, "job": JOB}).status_code == 401


# --- Real model -----------------------------------------------------------


def test_related_content_scores_higher_than_unrelated(real_embedding_service):
    developer = match_semantically(request(), real_embedding_service)
    nurse_resume = {
        "summary": "Registered nurse.",
        "experience": [{"title": "Nurse", "company": "City Hospital", "description": ["Provided patient care in the emergency department."]}],
        "skills": ["Patient care", "Triage"],
    }
    nurse = match_semantically(request(resume=nurse_resume), real_embedding_service)
    assert developer.overallSemanticSimilarity.similarity > nurse.overallSemanticSimilarity.similarity + 20
    assert developer.experienceSemanticSimilarity.similarity > nurse.experienceSemanticSimilarity.similarity + 20


def test_identical_content_is_close_to_100(real_embedding_service):
    same = {"summary": "Develop REST APIs and backend services with Node.js and Express."}
    job = {"title": "", "responsibilities": ["Develop REST APIs and backend services with Node.js and Express."]}
    result = match_semantically(request(resume={"experience": [{"description": same["summary"].split("  ")}]}, job=job), real_embedding_service)
    assert result.experienceSemanticSimilarity.similarity > 99


def test_very_long_text_is_handled(real_embedding_service):
    # Each field within its input limit; together far beyond the per-section chunk cap.
    long_resume = {**RESUME, "summary": "Built scalable backend services with Node.js. " * 400}
    result = match_semantically(request(resume=long_resume, job={**JOB, "description": "We build APIs. " * 3000}), real_embedding_service)
    assert result.overallSemanticSimilarity.status == "calculated"
    assert 0 <= result.overallSemanticSimilarity.similarity <= 100
    assert result.overallSemanticSimilarity.truncated is True


def test_endpoint_with_real_model(monkeypatch, real_embedding_service):
    monkeypatch.setattr(semantic_matcher, "get_embedding_service", lambda: real_embedding_service)
    response = client.post(URL, json={"resume_id": "r1", "job_description_id": "j1", "resume": RESUME, "job": JOB})
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Semantic similarity calculated successfully"
    match = body["data"]["semanticMatch"]
    assert match["metadata"]["model"] == "sentence-transformers/all-MiniLM-L6-v2"
    assert all(match[k]["status"] == "calculated" for k in ("overallSemanticSimilarity", "experienceSemanticSimilarity", "projectSemanticSimilarity", "skillsSemanticSimilarity"))
    # Embeddings themselves are never returned.
    assert "embedding" not in response.text.lower() and len(response.text) < 3000
