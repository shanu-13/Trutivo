import hmac

from fastapi import Header

from app.config import get_settings
from app.utils.responses import AppError


def require_internal_api_key(x_internal_api_key: str | None = Header(default=None)) -> None:
    """Only accept calls from the Node backend when INTERNAL_API_KEY is configured."""
    expected = get_settings().internal_api_key
    if not expected:
        return
    if not x_internal_api_key or not hmac.compare_digest(x_internal_api_key, expected):
        raise AppError(401, "UNAUTHORIZED", "Unauthorized")
