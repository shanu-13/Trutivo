"""Shared validation for free-text fields sent by the Node backend."""

from typing import Any

from pydantic_core import PydanticCustomError


def validate_text_input(
    value: Any,
    *,
    max_length: int,
    too_large_type: str,
    too_large_message: str,
    empty_type: str,
    empty_message: str,
) -> Any:
    """Reject oversized or blank text, returning it with outer whitespace removed."""
    if not isinstance(value, str):
        return value  # let pydantic raise its standard type error

    # Check the raw size first so oversized input is rejected before any work is done on it.
    if len(value) > max_length:
        raise PydanticCustomError(too_large_type, too_large_message)

    value = value.strip()
    if not value:
        raise PydanticCustomError(empty_type, empty_message)
    return value
