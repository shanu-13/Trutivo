import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _list_env(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # Maximum number of characters accepted for resume text.
    max_resume_text_length: int
    # Maximum number of characters accepted for job description text.
    max_job_description_text_length: int
    # Hard cap on the raw request body, checked before JSON parsing.
    max_request_body_bytes: int
    # Shared secret the Node backend sends in X-Internal-API-Key. Empty disables the check.
    internal_api_key: str
    # The AI service is called server-to-server, so no browser origins are allowed by default.
    cors_origins: list[str]
    # Hugging Face model id used for semantic matching.
    embedding_model_name: str
    # Load the embedding model in the background at startup instead of on the first request.
    preload_embedding_model: bool
    # "production" makes INTERNAL_API_KEY mandatory and hides the interactive API docs.
    environment: str


def get_settings() -> Settings:
    max_resume_text = _int_env("MAX_RESUME_TEXT_LENGTH", 100_000)
    max_job_description_text = _int_env("MAX_JOB_DESCRIPTION_TEXT_LENGTH", 50_000)
    max_text = max(max_resume_text, max_job_description_text)
    return Settings(
        max_resume_text_length=max_resume_text,
        max_job_description_text_length=max_job_description_text,
        # UTF-8 can use up to 4 bytes per char, and JSON escaping adds overhead.
        max_request_body_bytes=_int_env("MAX_REQUEST_BODY_BYTES", max_text * 6 + 1024),
        internal_api_key=os.getenv("INTERNAL_API_KEY", "").strip(),
        cors_origins=_list_env("CORS_ORIGINS"),
        embedding_model_name=os.getenv("EMBEDDING_MODEL_NAME", "").strip() or DEFAULT_EMBEDDING_MODEL,
        preload_embedding_model=os.getenv("PRELOAD_EMBEDDING_MODEL", "true").strip().lower() not in {"0", "false", "no"},
        environment=os.getenv("ENVIRONMENT", "development").strip().lower() or "development",
    )


def configuration_errors(settings: Settings) -> list[str]:
    """Problems that must stop the service from starting (names only, never values)."""
    errors = []
    key = settings.internal_api_key
    if settings.environment == "production" and (not key or key.lower().startswith(("replace-with", "replace_with", "your_", "your-"))):
        errors.append("INTERNAL_API_KEY must be set when ENVIRONMENT=production (it must match the backend's INTERNAL_API_KEY).")
    elif settings.environment == "production" and len(key) < 32:
        errors.append("INTERNAL_API_KEY must be at least 32 characters.")
    return errors
