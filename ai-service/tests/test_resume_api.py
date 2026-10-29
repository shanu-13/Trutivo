import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

URL = "/api/resume/preprocess"


def assert_error(response, status_code: int, code: str):
    assert response.status_code == status_code
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    return body


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "message": "AI service is running",
        "data": {"status": "healthy"},
    }


def test_preprocess_normal_text():
    response = client.post(URL, json={"resume_id": "123", "text": "John Doe\nSoftware Engineer"})
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "message": "Resume text preprocessed successfully",
        "data": {"resumeId": "123", "text": "John Doe\nSoftware Engineer"},
    }


def test_preprocess_cleans_messy_text():
    raw = "  John   Doe\r\n\r\n\r\n\r\nSoftware\tEngineer  \r\n"
    response = client.post(URL, json={"resume_id": " 123 ", "text": raw})
    assert response.status_code == 200
    assert response.json()["data"] == {"resumeId": "123", "text": "John Doe\n\nSoftware Engineer"}


def test_preprocess_handles_unicode():
    response = client.post(URL, json={"resume_id": "1", "text": "José Müller\nﬁnance 日本語 😀"})
    assert response.status_code == 200
    assert response.json()["data"]["text"] == "José Müller\nfinance 日本語 😀"


def test_empty_text_is_rejected():
    body = assert_error(client.post(URL, json={"resume_id": "1", "text": ""}), 400, "EMPTY_RESUME_TEXT")
    assert body == {
        "success": False,
        "message": "Resume text cannot be empty",
        "error": {"code": "EMPTY_RESUME_TEXT", "details": None},
    }


@pytest.mark.parametrize("text", ["   ", "\n\n\t \r\n", "​﻿­"])
def test_whitespace_or_invisible_only_text_is_rejected(text):
    assert_error(client.post(URL, json={"resume_id": "1", "text": text}), 400, "EMPTY_RESUME_TEXT")


def test_text_over_limit_is_rejected():
    body = assert_error(
        client.post(URL, json={"resume_id": "1", "text": "a" * 100_001}), 413, "RESUME_TEXT_TOO_LARGE"
    )
    assert body["message"] == "Resume text is too large"


def test_text_at_limit_is_accepted():
    response = client.post(URL, json={"resume_id": "1", "text": "a" * 100_000})
    assert response.status_code == 200


def test_limit_is_configurable(monkeypatch):
    monkeypatch.setenv("MAX_RESUME_TEXT_LENGTH", "10")
    assert_error(client.post(URL, json={"resume_id": "1", "text": "a" * 11}), 413, "RESUME_TEXT_TOO_LARGE")
    assert client.post(URL, json={"resume_id": "1", "text": "a" * 10}).status_code == 200


def test_oversized_body_rejected_before_parsing(monkeypatch):
    monkeypatch.setenv("MAX_REQUEST_BODY_BYTES", "100")
    payload = json.dumps({"resume_id": "1", "text": "a" * 200})
    response = client.post(URL, content=payload, headers={"Content-Type": "application/json"})
    assert_error(response, 413, "RESUME_TEXT_TOO_LARGE")


@pytest.mark.parametrize(
    "payload",
    [{"text": "hello"}, {"resume_id": "1"}, {"resume_id": "", "text": "hello"}, {"resume_id": "1", "text": 42}],
)
def test_invalid_payloads_are_rejected(payload):
    body = assert_error(client.post(URL, json=payload), 400, "VALIDATION_ERROR")
    assert isinstance(body["error"]["details"], list)


def test_validation_errors_do_not_echo_resume_text():
    secret = "john.doe@example.com +1-555-0100"
    response = client.post(URL, json={"text": secret})
    assert response.status_code == 400
    assert secret not in response.text


def test_internal_api_key_enforced_when_configured(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "test-key")
    payload = {"resume_id": "1", "text": "hello"}

    assert_error(client.post(URL, json=payload), 401, "UNAUTHORIZED")
    assert_error(client.post(URL, json=payload, headers={"X-Internal-API-Key": "wrong"}), 401, "UNAUTHORIZED")
    assert client.post(URL, json=payload, headers={"X-Internal-API-Key": "test-key"}).status_code == 200
    # Health stays public so the backend/docker can probe it.
    assert client.get("/api/health").status_code == 200


def test_unknown_route_uses_standard_envelope():
    assert_error(client.get("/api/does-not-exist"), 404, "NOT_FOUND")
