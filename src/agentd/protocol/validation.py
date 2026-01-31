"""
Schema validation for the Agent Runtime Protocol.

This module provides validation of events and requests against the JSON schema.
"""

import json
from pathlib import Path
from typing import Any

import jsonschema
from jsonschema import Draft7Validator

# jsonschema is now a core dependency - always available
VALIDATION_AVAILABLE = True


# Load schema once at module import
_SCHEMA_PATH = Path(__file__).parent / "schema.json"
with open(_SCHEMA_PATH) as f:
    PROTOCOL_SCHEMA = json.load(f)

# Protocol version from schema
PROTOCOL_VERSION = PROTOCOL_SCHEMA["version"]


class ValidationError(Exception):
    """Raised when an event or request fails schema validation."""

    def __init__(self, message: str, errors: list[str] | None = None):
        super().__init__(message)
        self.errors = errors or []


def validate_event(event_dict: dict[str, Any]) -> None:
    """
    Validate an event against the protocol schema.

    Args:
        event_dict: The event dictionary to validate (with type, data, timestamp)

    Raises:
        ValidationError: If the event is invalid
    """
    try:
        validator = Draft7Validator(PROTOCOL_SCHEMA)
        errors = list(validator.iter_errors(event_dict))
        if errors:
            error_messages = [f"{err.json_path}: {err.message}" for err in errors]
            raise ValidationError(
                f"Event validation failed: {'; '.join(error_messages)}",
                error_messages,
            )
    except jsonschema.ValidationError as e:
        raise ValidationError(f"Event validation failed: {e.message}") from e


def validate_request(request_dict: dict[str, Any]) -> None:
    """
    Validate a request against the protocol schema.

    Args:
        request_dict: The request dictionary to validate (with id, method, params)

    Raises:
        ValidationError: If the request is invalid
    """
    # Validate against the request definition
    request_schema = PROTOCOL_SCHEMA["definitions"]["request"]
    try:
        validator = Draft7Validator(request_schema)
        errors = list(validator.iter_errors(request_dict))
        if errors:
            error_messages = [f"{err.json_path}: {err.message}" for err in errors]
            raise ValidationError(
                f"Request validation failed: {'; '.join(error_messages)}",
                error_messages,
            )
    except jsonschema.ValidationError as e:
        raise ValidationError(f"Request validation failed: {e.message}") from e


def get_protocol_version() -> str:
    """Get the protocol version from the schema."""
    return PROTOCOL_VERSION
