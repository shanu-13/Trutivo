"""Response helpers that mirror the Node backend's API envelope."""

from typing import Any

from fastapi.responses import JSONResponse


class AppError(Exception):
    """An expected error that maps to a structured API error response."""

    def __init__(self, status_code: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def success_response(message: str, data: Any = None) -> dict:
    return {"success": True, "message": message, "data": data}


def error_response(status_code: int, code: str, message: str, details: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "message": message,
            "error": {"code": code, "details": details},
        },
    )
