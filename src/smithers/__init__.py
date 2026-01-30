"""
Smithers: Build AI agent workflows the way you build software.

Smithers is a Python framework for composing LLM agents into type-safe,
cacheable, parallel workflows.
"""

from smithers.analytics import (
    BudgetExceededAction,
    BudgetExceededError,
    ModelPricing,
    TokenBudget,
    UsageAnalytics,
    UsageSummary,
    calculate_cost,
    clear_custom_pricing,
    get_daily_usage,
    get_model_pricing,
    get_run_cost,
    get_run_tokens,
    recalculate_run_costs,
    register_model_pricing,
)
from smithers.cache import Cache, SqliteCache
from smithers.claude import claude
from smithers.config import configure
from smithers.errors import ApprovalRejected, ClaudeError, RateLimitError, WorkflowError
from smithers.events import (
    Event,
    EventBus,
    EventTypes,
    Subscription,
    get_event_bus,
    reset_event_bus,
    set_event_bus,
)
from smithers.executor import PauseExecution, resume_run, run_graph_with_store
from smithers.graph import build_graph, run_graph
from smithers.hashing import cache_key, canonical_json, hash_json, hash_string
from smithers.runtime import (
    RuntimeContext,
    get_current_context,
    runtime_context,
)
from smithers.store.sqlite import SqliteStore
from smithers.testing import (
    FakeLLMProvider,
    RecordingStore,
    ReplayLLMProvider,
    use_fake_llm,
    use_recording,
    use_recording_or_replay,
    use_replay,
)
from smithers.tools import Tool
from smithers.types import (
    CacheStats,
    ExecutionResult,
    NO_RETRY,
    RETRY_ONCE,
    RETRY_THREE_TIMES,
    RETRY_WITH_BACKOFF,
    RetryPolicy,
    WorkflowGraph,
)
from smithers.verification import (
    CacheVerificationResult,
    GraphVerificationResult,
    IssueCode,
    IssueSeverity,
    OutputVerificationResult,
    VerificationIssue,
    full_verification,
    verify_cache_entry,
    verify_cache_integrity,
    verify_graph,
    verify_output,
    verify_run_state,
    verify_workflow_output,
)
from smithers.workflow import require_approval, require_approval_async, retry, skip, workflow

__version__ = "0.1.0"

__all__ = [
    "ApprovalRejected",
    "BudgetExceededAction",
    "BudgetExceededError",
    "Cache",
    "CacheStats",
    "CacheVerificationResult",
    "ClaudeError",
    "Event",
    "EventBus",
    "EventTypes",
    "ExecutionResult",
    "FakeLLMProvider",
    "GraphVerificationResult",
    "IssueCode",
    "IssueSeverity",
    "ModelPricing",
    "NO_RETRY",
    "OutputVerificationResult",
    "PauseExecution",
    "RETRY_ONCE",
    "RETRY_THREE_TIMES",
    "RETRY_WITH_BACKOFF",
    "RateLimitError",
    "RecordingStore",
    "ReplayLLMProvider",
    "RetryPolicy",
    "RuntimeContext",
    "SqliteCache",
    "SqliteStore",
    "Subscription",
    "TokenBudget",
    "Tool",
    "UsageAnalytics",
    "UsageSummary",
    "VerificationIssue",
    "WorkflowError",
    "WorkflowGraph",
    "__version__",
    "build_graph",
    "cache_key",
    "calculate_cost",
    "canonical_json",
    "clear_custom_pricing",
    "claude",
    "configure",
    "full_verification",
    "get_current_context",
    "get_daily_usage",
    "get_event_bus",
    "get_model_pricing",
    "get_run_cost",
    "get_run_tokens",
    "hash_json",
    "hash_string",
    "recalculate_run_costs",
    "register_model_pricing",
    "require_approval",
    "require_approval_async",
    "reset_event_bus",
    "resume_run",
    "retry",
    "run_graph",
    "run_graph_with_store",
    "runtime_context",
    "set_event_bus",
    "skip",
    "use_fake_llm",
    "use_recording",
    "use_recording_or_replay",
    "use_replay",
    "verify_cache_entry",
    "verify_cache_integrity",
    "verify_graph",
    "verify_output",
    "verify_run_state",
    "verify_workflow_output",
    "workflow",
]
