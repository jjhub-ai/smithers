"""
Response models for the Agent Runtime Protocol.

Responses are sent in reply to requests, providing structured RPC-style
request-response correlation. They follow JSON-RPC 2.0 style conventions.

Usage:
    # Success response
    response = Response.success("req-123", {"session_id": "s1"})

    # Error response
    response = Response.from_error("req-456", "NOT_FOUND", "Session not found")

    # Error with additional data
    response = Response.from_error(
        "req-789",
        "INVALID_PARAMS",
        "Missing parameter",
        {"param": "session_id"}
    )

When to use Responses vs Events:
    - Responses: Immediate replies to requests (session.create → response with session_id)
    - Events: Asynchronous notifications (streaming text, tool execution, checkpoints)
"""

from dataclasses import dataclass, field
from typing import Any

# Sentinel to distinguish "not provided" from "None"
_UNSET = object()


@dataclass
class Response:
    """
    A protocol response to send to Swift.

    Responses follow JSON-RPC 2.0 style with either result or error, not both.
    Use the success() or error() class methods to create responses.
    """

    id: str  # Correlates with Request.id
    result: dict[str, Any] | None = field(default=_UNSET)  # type: ignore[assignment]
    error: dict[str, Any] | None = field(default=_UNSET)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        """Validate that response has either result or error, not both."""
        has_result = self.result is not _UNSET
        has_error = self.error is not _UNSET

        if has_result and has_error:
            raise ValueError("Cannot have both result and error in a response")
        if not has_result and not has_error:
            raise ValueError("Response must have either result or error")

        # Convert _UNSET to None for the fields that weren't set
        if self.result is _UNSET:
            self.result = None
        if self.error is _UNSET:
            self.error = None

    @classmethod
    def success(cls, request_id: str, result: dict[str, Any] | None = None) -> "Response":
        """Create a success response."""
        return cls(id=request_id, result=result or {}, error=_UNSET)  # type: ignore[arg-type]

    @classmethod
    def from_error(
        cls, request_id: str, code: str, message: str, data: dict[str, Any] | None = None
    ) -> "Response":
        """Create an error response."""
        error_data: dict[str, Any] = {"code": code, "message": message}
        if data:
            error_data["data"] = data
        return cls(id=request_id, result=_UNSET, error=error_data)  # type: ignore[arg-type]

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict."""
        return {
            "id": self.id,
            "result": self.result,
            "error": self.error,
        }

    def validate(self) -> None:
        """
        Validate this response against the protocol schema.

        Raises:
            ValidationError: If the response doesn't match the schema
        """
        from agentd.protocol.validation import validate_response

        validate_response(self.to_dict())
