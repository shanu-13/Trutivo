import logging

from fastapi import APIRouter, Depends

from app.models.cover_letter import CoverLetterRequest
from app.security import require_internal_api_key
from app.services.cover_letter_generator import compose_cover_letter
from app.utils.responses import AppError, success_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/cover-letter",
    tags=["cover-letter"],
    dependencies=[Depends(require_internal_api_key)],
)


@router.post("/generate")
def generate(payload: CoverLetterRequest):
    """Rule-based cover letter from structured resume and job facts (no language model)."""
    try:
        letter = compose_cover_letter(payload)
    except AppError:
        raise
    except Exception as exc:
        # Log only the exception type: messages can quote resume content.
        logger.error("Cover letter generation failed: %s", type(exc).__name__)
        raise AppError(500, "COVER_LETTER_FAILED", "Cover letter generation failed") from None
    return success_response("Cover letter generated successfully", {"coverLetter": letter.model_dump()})
