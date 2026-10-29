import subprocess
import sys
from pathlib import Path

from app.config import configuration_errors, get_settings

SERVICE_ROOT = Path(__file__).resolve().parent.parent


def test_development_allows_missing_internal_key(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("INTERNAL_API_KEY", "")
    settings = get_settings()
    assert settings.environment == "development"
    assert configuration_errors(settings) == []


def test_production_requires_a_long_internal_key(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("INTERNAL_API_KEY", "")
    assert any("INTERNAL_API_KEY must be set" in e for e in configuration_errors(get_settings()))
    monkeypatch.setenv("INTERNAL_API_KEY", "short")
    assert any("at least 32" in e for e in configuration_errors(get_settings()))
    monkeypatch.setenv("INTERNAL_API_KEY", "replace-with-another-64-random-hex-characters")
    assert any("INTERNAL_API_KEY must be set" in e for e in configuration_errors(get_settings()))
    monkeypatch.setenv("INTERNAL_API_KEY", "k" * 40)
    assert configuration_errors(get_settings()) == []


def _start(env: dict) -> subprocess.CompletedProcess:
    # Importing the app runs the startup checks; a fresh interpreter keeps them isolated.
    code = "import app.main as m; print('docs', m.app.docs_url, m.app.openapi_url)"
    return subprocess.run([sys.executable, "-c", code], cwd=SERVICE_ROOT, env={"PATH": "", "PRELOAD_EMBEDDING_MODEL": "false", **env}, capture_output=True, text=True, timeout=120)


def test_production_without_key_refuses_to_start():
    result = _start({"ENVIRONMENT": "production", "INTERNAL_API_KEY": ""})
    assert result.returncode != 0
    assert "INTERNAL_API_KEY must be set" in result.stderr
    assert "k" * 40 not in result.stderr


def test_production_hides_docs_development_keeps_them():
    prod = _start({"ENVIRONMENT": "production", "INTERNAL_API_KEY": "k" * 40})
    assert prod.returncode == 0, prod.stderr
    assert "docs None None" in prod.stdout
    dev = _start({"ENVIRONMENT": "development", "INTERNAL_API_KEY": ""})
    assert dev.returncode == 0, dev.stderr
    assert "docs /docs /openapi.json" in dev.stdout
