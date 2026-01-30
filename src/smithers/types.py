"""Core types for Smithers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, TypeVar

from pydantic import BaseModel

if TYPE_CHECKING:
    from smithers.workflow import Workflow

T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True)
class RetryPolicy:
    """
    Configuration for retry behavior with exponential backoff.

    This class defines how workflows should handle transient failures.
    When a workflow fails with a retryable exception, the executor will
    retry according to this policy.

    Attributes:
        max_attempts: Maximum number of attempts (including the initial try).
                      Must be >= 1. Default is 1 (no retries).
        backoff_seconds: Initial delay between retries in seconds.
                         Default is 1.0 second.
        backoff_multiplier: Multiplier applied to backoff after each retry.
                            Default is 2.0 (exponential backoff).
        max_backoff_seconds: Maximum delay between retries in seconds.
                             Default is 60.0 seconds.
        jitter: Whether to add random jitter to backoff timing.
                Helps avoid thundering herd problems. Default is True.
        retry_on: Tuple of exception types that should trigger a retry.
                  If empty, all exceptions are retryable.
                  Default is empty (retry on all exceptions).

    Example:
        # Retry up to 3 times with exponential backoff
        policy = RetryPolicy(max_attempts=3, backoff_seconds=1.0, backoff_multiplier=2.0)

        # Only retry on specific exceptions
        policy = RetryPolicy(
            max_attempts=5,
            retry_on=(RateLimitError, ConnectionError),
        )

        # Fixed delay (no exponential backoff)
        policy = RetryPolicy(max_attempts=3, backoff_multiplier=1.0)
    """

    max_attempts: int = 1
    backoff_seconds: float = 1.0
    backoff_multiplier: float = 2.0
    max_backoff_seconds: float = 60.0
    jitter: bool = True
    retry_on: tuple[type[BaseException], ...] = ()

    def __post_init__(self) -> None:
        """Validate retry policy parameters."""
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        if self.backoff_seconds < 0:
            raise ValueError("backoff_seconds must be >= 0")
        if self.backoff_multiplier < 1:
            raise ValueError("backoff_multiplier must be >= 1")
        if self.max_backoff_seconds < 0:
            raise ValueError("max_backoff_seconds must be >= 0")

    def should_retry(self, exception: BaseException, attempt: int) -> bool:
        """
        Determine if a retry should be attempted.

        Args:
            exception: The exception that was raised
            attempt: The current attempt number (1-indexed)

        Returns:
            True if the exception should trigger a retry
        """
        # Check if we've exhausted attempts
        if attempt >= self.max_attempts:
            return False

        # If no specific exceptions are configured, retry on all
        if not self.retry_on:
            return True

        # Check if the exception matches any retryable type
        return isinstance(exception, self.retry_on)

    def get_delay(self, attempt: int) -> float:
        """
        Calculate the delay before the next retry.

        Uses exponential backoff with optional jitter.

        Args:
            attempt: The current attempt number (1-indexed)

        Returns:
            The delay in seconds before the next retry
        """
        import random

        # Calculate exponential backoff
        delay = self.backoff_seconds * (self.backoff_multiplier ** (attempt - 1))

        # Cap at maximum
        delay = min(delay, self.max_backoff_seconds)

        # Add jitter if enabled (random value between 0 and delay)
        if self.jitter:
            delay = delay * (0.5 + random.random() * 0.5)

        return delay


# Default retry policy (no retries)
NO_RETRY = RetryPolicy(max_attempts=1)

# Common retry policies
RETRY_ONCE = RetryPolicy(max_attempts=2)
RETRY_THREE_TIMES = RetryPolicy(max_attempts=4, backoff_seconds=1.0)
RETRY_WITH_BACKOFF = RetryPolicy(max_attempts=5, backoff_seconds=1.0, backoff_multiplier=2.0)


@dataclass
class WorkflowNode:
    """A node in the workflow graph."""

    name: str
    output_type: type[BaseModel]
    dependencies: list[str] = field(default_factory=list)
    requires_approval: bool = False
    approval_message: str | None = None


@dataclass
class WorkflowGraph:
    """A complete workflow execution graph."""

    root: str
    nodes: dict[str, WorkflowNode] = field(default_factory=dict)
    edges: list[tuple[str, str]] = field(default_factory=list)
    levels: list[list[str]] = field(default_factory=list)
    workflows: dict[str, Workflow[Any, Any]] = field(default_factory=dict, repr=False)

    def mermaid(self) -> str:
        """Generate a Mermaid diagram of the graph."""
        lines = ["graph LR"]
        for from_node, to_node in self.edges:
            lines.append(f"    {from_node} --> {to_node}")
        connected = {node for edge in self.edges for node in edge}
        for node in sorted(self.nodes.keys()):
            if node not in connected:
                lines.append(f"    {node}")
        return "\n".join(lines)


@dataclass
class WorkflowResult:
    """Result of a workflow execution."""

    name: str
    output: Any
    cached: bool = False
    duration_ms: float = 0.0


@dataclass
class CacheStats:
    """Statistics about cache usage."""

    entries: int = 0
    hits: int = 0
    misses: int = 0
    size_bytes: int = 0


@dataclass
class ApprovalRecord:
    """Record of a human approval decision."""

    workflow_name: str
    decision: bool
    timestamp: datetime
    message: str
    user: str | None = None
    reason: str | None = None


@dataclass
class ExecutionStats:
    """Aggregate execution statistics."""

    total_duration_ms: float = 0.0
    workflows_executed: int = 0
    workflows_cached: int = 0
    tokens_used: int = 0


@dataclass
class ExecutionResult:
    """Expanded result from running a graph."""

    output: Any
    outputs: dict[str, Any]
    results: list[WorkflowResult]
    stats: ExecutionStats
    approvals: list[ApprovalRecord] = field(default_factory=list)


@dataclass
class DryRunPlan:
    """Dry-run execution plan."""

    workflows: list[str]
    levels: list[list[str]]
    estimated_cost: float | None = None


@dataclass
class WorkflowEvent:
    """Lightweight progress event emitted during execution."""

    type: str
    workflow_name: str | None = None
    duration_ms: float | None = None
    message: str | None = None
