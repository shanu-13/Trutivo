import logging

from fastapi import APIRouter, Depends

from app.models.resume import (
    ResumeAnalysisRequest,
    ResumePreprocessRequest,
    SectionExtractionRequest,
    SkillExtractionRequest,
)
from app.security import require_internal_api_key
from app.services.resume_analyzer import analyze_resume_text
from app.services.resume_preprocessor import preprocess_resume
from app.services.section_extractor import extract_resume_sections
from app.services.skill_extractor import extract_resume_skills
from app.utils.responses import AppError, success_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/resume",
    tags=["resume"],
    dependencies=[Depends(require_internal_api_key)],
)


@router.post("/preprocess")
def preprocess(payload: ResumePreprocessRequest):
    result = preprocess_resume(payload.resume_id, payload.text)
    return success_response("Resume text preprocessed successfully", result.model_dump())


@router.post("/extract-skills")
def extract_skills(payload: SkillExtractionRequest):
    result = extract_resume_skills(payload.resume_id, payload.text)
    return success_response("Resume skills extracted successfully", result.model_dump())


@router.post("/extract-sections")
def extract_sections(payload: SectionExtractionRequest):
    result = extract_resume_sections(payload.resume_id, payload.text)
    # Sections that were not found are omitted rather than returned as null.
    return success_response("Resume sections extracted successfully", result.model_dump(exclude_none=True))


@router.post("/analyze")
def analyze(payload: ResumeAnalysisRequest):
    try:
        result = analyze_resume_text(payload.resume_id, payload.text)
    except AppError:
        raise
    except Exception as exc:
        # Log only the exception type: messages and tracebacks can quote resume text.
        logger.error("Resume analysis failed: %s", type(exc).__name__)
        raise AppError(500, "RESUME_ANALYSIS_FAILED", "Resume analysis failed") from None
    return success_response("Resume analyzed successfully", result.model_dump())
