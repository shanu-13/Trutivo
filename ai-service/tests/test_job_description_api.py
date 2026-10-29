import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.job_description_preprocessor import preprocess_job_description

client = TestClient(app)

URL = "/api/job-description/preprocess"


def assert_error(response, status_code: int, code: str):
    assert response.status_code == status_code
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    return body


def processed(text: str) -> str:
    response = client.post(URL, json={"job_description_id": "jd-1", "text": text})
    assert response.status_code == 200
    return response.json()["data"]["processedText"]


def test_normal_job_description():
    text = "We are looking for a frontend developer with React experience."
    response = client.post(URL, json={"job_description_id": "123", "text": text})
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "message": "Job description processed successfully",
        "data": {"jobDescriptionId": "123", "processedText": text},
    }


def test_extra_whitespace_is_normalized():
    assert processed("  We   are\thiring  a developer.  \r\n  Apply   now. ") == (
        "We are hiring a developer.\nApply now."
    )


def test_multiple_blank_lines_are_normalized():
    assert processed("About us\r\n\r\n\r\n\r\n\nThe role\n\n\n\nRequirements") == (
        "About us\n\nThe role\n\nRequirements"
    )


def test_bullet_points_and_requirements_are_preserved():
    text = (
        "Requirements:\n"
        "- React\n"
        "-   TypeScript\n"
        "•\tNode.js\n"
        "* 2+ years experience\n"
        "1. Strong communication skills.\n\n"
        "Nice to have: GraphQL; AWS (EC2, S3)."
    )
    assert processed(text) == (
        "Requirements:\n"
        "- React\n"
        "- TypeScript\n"
        "• Node.js\n"
        "* 2+ years experience\n"
        "1. Strong communication skills.\n\n"
        "Nice to have: GraphQL; AWS (EC2, S3)."
    )


def test_sentence_boundaries_and_details_are_kept():
    text = "Salary: $120,000 - $150,000/yr. Location: Remote (US). Apply by 2026-12-31!"
    assert processed(text) == text


def test_unicode_is_normalized_without_losing_content():
    # Ligatures expand, zero-width characters disappear, accents and symbols remain.
    assert processed("Oﬃce in São Paulo™​ — C# / C++ / Node.js 日本語") == (
        "Office in São Paulo™ — C# / C++ / Node.js 日本語"
    )


def test_job_description_id_is_trimmed():
    response = client.post(URL, json={"job_description_id": " jd-9 ", "text": "Hiring"})
    assert response.json()["data"]["jobDescriptionId"] == "jd-9"


@pytest.mark.parametrize("text", ["", "   ", "\n\n\t \r\n", "​﻿­"])
def test_empty_description_is_rejected(text):
    body = assert_error(
        client.post(URL, json={"job_description_id": "1", "text": text}), 400, "EMPTY_JOB_DESCRIPTION_TEXT"
    )
    assert body["message"] == "Job description text cannot be empty"


def test_very_large_description_is_rejected():
    body = assert_error(
        client.post(URL, json={"job_description_id": "1", "text": "a" * 50_001}), 413, "JOB_DESCRIPTION_TEXT_TOO_LARGE"
    )
    assert body["message"] == "Job description text is too large"


def test_description_at_limit_is_accepted():
    assert client.post(URL, json={"job_description_id": "1", "text": "a" * 50_000}).status_code == 200


def test_limit_is_configurable(monkeypatch):
    monkeypatch.setenv("MAX_JOB_DESCRIPTION_TEXT_LENGTH", "10")
    assert_error(
        client.post(URL, json={"job_description_id": "1", "text": "a" * 11}), 413, "JOB_DESCRIPTION_TEXT_TOO_LARGE"
    )
    assert client.post(URL, json={"job_description_id": "1", "text": "a" * 10}).status_code == 200


def test_oversized_body_rejected_before_parsing(monkeypatch):
    monkeypatch.setenv("MAX_REQUEST_BODY_BYTES", "100")
    payload = json.dumps({"job_description_id": "1", "text": "a" * 200})
    response = client.post(URL, content=payload, headers={"Content-Type": "application/json"})
    assert_error(response, 413, "JOB_DESCRIPTION_TEXT_TOO_LARGE")


def test_resume_limits_are_unchanged():
    # The job description limit does not change what the resume endpoints accept.
    response = client.post("/api/resume/preprocess", json={"resume_id": "1", "text": "a" * 100_000})
    assert response.status_code == 200
    assert_error(
        client.post("/api/resume/preprocess", json={"resume_id": "1", "text": "a" * 100_001}),
        413,
        "RESUME_TEXT_TOO_LARGE",
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "hello"},
        {"job_description_id": "1"},
        {"job_description_id": "", "text": "hello"},
        {"job_description_id": "x" * 65, "text": "hello"},
        {"job_description_id": "1", "text": 42},
        {"resume_id": "1", "text": "hello"},
    ],
)
def test_invalid_payloads_are_rejected(payload):
    body = assert_error(client.post(URL, json=payload), 400, "VALIDATION_ERROR")
    assert isinstance(body["error"]["details"], list)


def test_validation_errors_do_not_echo_text():
    secret = "Confidential role at Acme, contact hr@acme.example"
    response = client.post(URL, json={"text": secret})
    assert response.status_code == 400
    assert secret not in response.text


def test_internal_api_key_enforced_when_configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    payload = {"job_description_id": "1", "text": "Hiring"}
    assert_error(client.post(URL, json=payload), 401, "UNAUTHORIZED")
    assert_error(client.post(URL, json=payload, headers={"X-Internal-API-Key": "wrong"}), 401, "UNAUTHORIZED")
    assert client.post(URL, json=payload, headers={"X-Internal-API-Key": "test-key"}).status_code == 200


def test_preprocessor_function_directly():
    assert preprocess_job_description("  Hiring\r\n\r\n\r\n- React  ") == "Hiring\n\n- React"
