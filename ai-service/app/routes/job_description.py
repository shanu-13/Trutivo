import logging

from fastapi import APIRouter, Depends

from app.models.job_description import JobDescriptionProcessRequest, JobRequirementsRequest
from app.security import require_internal_api_key
from app.services.job_description_preprocessor import process_job_description
from app.services.job_requirement_extractor import extract_requirements_for_job_description
from app.utils.responses import AppError, success_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/job-description",
    tags=["job-description"],
    dependencies=[Depends(require_internal_api_key)],
)


@router.post("/preprocess")
def preprocess(payload: JobDescriptionProcessRequest):
    result = process_job_description(payload.job_description_id, payload.text)
    return success_response("Job description processed successfully", result.model_dump())


@router.post("/extract-requirements")
def extract_requirements(payload: JobRequirementsRequest):
    try:
        result = extract_requirements_for_job_description(payload.job_description_id, payload.text, payload.job_title)
    except AppError:
        raise
    except Exception as exc:
        # Log only the exception type: messages and tracebacks can quote the job description.
        logger.error("Job requirement extraction failed: %s", type(exc).__name__)
        raise AppError(500, "JOB_REQUIREMENT_EXTRACTION_FAILED", "Job requirement extraction failed") from None
    return success_response("Job requirements extracted successfully", result.model_dump())
