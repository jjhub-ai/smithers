"""Custom error types for Smithers."""

from __future__ import annotations

from typing import Any


class SmithersError(Exception):
    """Base exception for Smithers errors."""


class WorkflowError(SmithersError):
    """Raised when one or more workflows fail during execution."""

    def __init__(
        self,
        workflow_name: str,
        cause: BaseException,
        *,
        completed: list[str] | None = None,
        errors: dict[str, BaseException] | None = None,
    ) -> None:
        super().__init__(str(cause))
        self.workflow_name = workflow_name
        self.cause = cause
        self.completed = completed or []
        self.errors = errors or {}


class ApprovalRejected(SmithersError):
    """Raised when a required approval is rejected."""

    def __init__(self, workflow_name: str, reason: str | None = None) -> None:
        message = reason or "Approval rejected"
        super().__init__(message)
        self.workflow_name = workflow_name
        self.reason = reason


class ClaudeError(SmithersError):
    """Raised when the Claude API returns an error."""

    def __init__(self, message: str, *, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.cause = cause


class RateLimitError(ClaudeError):
    """Raised when the Claude API rate limits the request."""

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        *,
        retry_after: float | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message, cause=cause)
        self.retry_after = retry_after


class ToolError(SmithersError):
    """Raised when tool execution fails."""

    def __init__(self, tool_name: str, message: str, *, data: Any | None = None) -> None:
        super().__init__(message)
        self.tool_name = tool_name
        self.data = data
