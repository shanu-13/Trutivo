import logging

from fastapi import APIRouter, Depends

from app.models.interview import EvaluationRequest, QuestionRequest
from app.security import require_internal_api_key
from app.services.interview_evaluator import evaluate_answer
from app.services.interview_generator import generate_questions
from app.utils.responses import AppError, success_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/interview",
    tags=["interview"],
    dependencies=[Depends(require_internal_api_key)],
)


@router.post("/questions")
def questions(payload: QuestionRequest):
    """Rule-based mock interview questions from structured resume and job facts (no language model)."""
    try:
        result = generate_questions(payload)
    except Exception as exc:
        # Log only the exception type: messages can quote resume content.
        logger.error("Interview question generation failed: %s", type(exc).__name__)
        raise AppError(500, "INTERVIEW_GENERATION_FAILED", "Interview question generation failed") from None
    if not result.questions:
        raise AppError(422, "INTERVIEW_NO_QUESTIONS", "No interview questions could be prepared from these documents")
    return success_response("Interview questions generated successfully", {"questionSet": result.model_dump()})


@router.post("/evaluate")
def evaluate(payload: EvaluationRequest):
    """Rule-based feedback on one answer (no language model)."""
    try:
        evaluation = evaluate_answer(payload)
    except Exception as exc:
        logger.error("Interview answer evaluation failed: %s", type(exc).__name__)
        raise AppError(500, "INTERVIEW_EVALUATION_FAILED", "Answer evaluation failed") from None
    return success_response("Answer evaluated successfully", {"evaluation": evaluation.model_dump()})
