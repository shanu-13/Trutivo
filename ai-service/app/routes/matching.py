import logging

from fastapi import APIRouter, Depends

from app.models.matching import MatchAnalysisRequest, MatchingRequest, RecommendationRequest, SemanticMatchRequest
from app.security import require_internal_api_key
from app.services.embedding_service import EmbeddingModelUnavailable
from app.services.match_analysis_service import analyze_match_results
from app.services.match_score_calculator import score_matching_result
from app.services.resume_job_matcher import analyze_match
from app.services.resume_recommendation_service import build_recommendations
from app.services.semantic_matcher import match_semantically
from app.utils.responses import AppError, success_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/matching",
    tags=["matching"],
    dependencies=[Depends(require_internal_api_key)],
)


@router.post("/analyze")
def analyze(payload: MatchingRequest):
    try:
        result = score_matching_result(analyze_match(payload))
    except AppError:
        raise
    except Exception as exc:
        # Log only the exception type: messages and tracebacks can quote resume content.
        logger.error("Resume/job matching or scoring failed: %s", type(exc).__name__)
        raise AppError(500, "MATCHING_FAILED", "Resume and job matching failed") from None
    return success_response("Resume and job requirements analyzed successfully", {"matching": result.model_dump()})


@router.post("/semantic")
def semantic(payload: SemanticMatchRequest):
    """Semantic similarity, kept separate so the deterministic match never depends on the model."""
    try:
        result = match_semantically(payload)
    except AppError:
        raise
    except EmbeddingModelUnavailable:
        raise AppError(503, "EMBEDDING_MODEL_UNAVAILABLE", "Semantic matching service is currently unavailable.") from None
    except Exception as exc:
        # Log only the exception type: never resume/job text or embeddings.
        logger.error("Semantic matching failed: %s", type(exc).__name__)
        raise AppError(500, "SEMANTIC_MATCHING_FAILED", "Semantic matching failed") from None
    return success_response("Semantic similarity calculated successfully", {"semanticMatch": result.model_dump()})


@router.post("/analysis")
def analysis(payload: MatchAnalysisRequest):
    """Rule-based explanation of results already produced by /analyze and /semantic."""
    try:
        result = analyze_match_results(payload.matching, payload.semanticMatch, payload.semanticError)
    except Exception as exc:
        logger.error("Match analysis failed: %s", type(exc).__name__)
        raise AppError(500, "MATCH_ANALYSIS_FAILED", "Match analysis failed") from None
    return success_response("Match analysis generated successfully", {"analysis": result.model_dump()})


@router.post("/recommendations")
def recommendations(payload: RecommendationRequest):
    """Improvement recommendations built from the existing match results and analysis."""
    try:
        result = build_recommendations(payload.matching, payload.analysis, payload.resume)
    except Exception as exc:
        logger.error("Recommendation generation failed: %s", type(exc).__name__)
        raise AppError(500, "RECOMMENDATIONS_FAILED", "Recommendation generation failed") from None
    return success_response("Resume recommendations generated successfully", {"recommendations": result.model_dump()})
