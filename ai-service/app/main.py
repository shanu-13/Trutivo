import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import configuration_errors, get_settings
from app.models.job_description import EMPTY_JOB_DESCRIPTION_TEXT, JOB_DESCRIPTION_TEXT_TOO_LARGE
from app.models.resume import EMPTY_RESUME_TEXT, RESUME_TEXT_TOO_LARGE
from app.routes import cover_letter, health, interview, job_description, matching, resume
from app.services.embedding_service import preload_embedding_model
from app.utils.responses import AppError, error_response

settings = get_settings()

_config_errors = configuration_errors(settings)
if _config_errors:
    raise SystemExit("Invalid configuration:\n" + "\n".join(f"  - {e}" for e in _config_errors))
_production = settings.environment == "production"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the embedding model once, in the background, so the service accepts
    # requests immediately; semantic requests wait for (or report) the load.
    if get_settings().preload_embedding_model:
        threading.Thread(target=preload_embedding_model, name="embedding-model-preload", daemon=True).start()
    yield


# The interactive docs describe internal endpoints; they are off in production.
app = FastAPI(
    title="AI Service for Resume Analyzer",
    lifespan=lifespan,
    docs_url=None if _production else "/docs",
    redoc_url=None if _production else "/redoc",
    openapi_url=None if _production else "/openapi.json",
)

# Custom text-validation errors -> (status, code, message) returned to the backend.
_TEXT_VALIDATION_ERRORS = {
    RESUME_TEXT_TOO_LARGE: (413, "RESUME_TEXT_TOO_LARGE", "Resume text is too large"),
    EMPTY_RESUME_TEXT: (400, "EMPTY_RESUME_TEXT", "Resume text cannot be empty"),
    JOB_DESCRIPTION_TEXT_TOO_LARGE: (413, "JOB_DESCRIPTION_TEXT_TOO_LARGE", "Job description text is too large"),
    EMPTY_JOB_DESCRIPTION_TEXT: (400, "EMPTY_JOB_DESCRIPTION_TEXT", "Job description text cannot be empty"),
}

# The frontend never calls this service directly, so browser origins must be opted into explicitly.
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Internal-API-Key"],
    )


@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit():
        if int(content_length) > get_settings().max_request_body_bytes:
            if request.url.path.startswith(job_description.router.prefix):
                return error_response(*_TEXT_VALIDATION_ERRORS[JOB_DESCRIPTION_TEXT_TOO_LARGE])
            return error_response(*_TEXT_VALIDATION_ERRORS[RESUME_TEXT_TOO_LARGE])
    return await call_next(request)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return error_response(exc.status_code, exc.code, exc.message, exc.details)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    error_types = {err.get("type") for err in errors}

    # Size errors first: an oversized body should be reported as such even if it is also invalid.
    for error_type in (RESUME_TEXT_TOO_LARGE, JOB_DESCRIPTION_TEXT_TOO_LARGE, EMPTY_RESUME_TEXT, EMPTY_JOB_DESCRIPTION_TEXT):
        if error_type in error_types:
            return error_response(*_TEXT_VALIDATION_ERRORS[error_type])

    # Only report field locations and messages: the default FastAPI payload echoes
    # the submitted input, which would leak resume contents into responses and logs.
    details = [
        {
            "field": ".".join(str(part) for part in err.get("loc", ()) if part != "body"),
            "message": err.get("msg"),
        }
        for err in errors
    ]
    return error_response(400, "VALIDATION_ERROR", "Invalid request", details)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
    return error_response(exc.status_code, code, str(exc.detail))


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    return error_response(500, "INTERNAL_ERROR", "Internal Server Error")


app.include_router(health.router)
app.include_router(resume.router)
app.include_router(job_description.router)
app.include_router(matching.router)
app.include_router(cover_letter.router)
app.include_router(interview.router)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
