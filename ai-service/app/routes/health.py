from fastapi import APIRouter

from app.utils.responses import success_response

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health_check():
    return success_response("AI service is running", {"status": "healthy"})
