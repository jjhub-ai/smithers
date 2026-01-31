"""
Agent adapters - pluggable backends for agent execution.

Supports:
- FakeAgentAdapter: Deterministic testing
- AnthropicAgentAdapter: Raw Anthropic API
"""

from agentd.adapters.base import AgentAdapter
from agentd.adapters.fake import FakeAgentAdapter
from agentd.adapters.anthropic import AnthropicAgentAdapter

__all__ = ["AgentAdapter", "FakeAgentAdapter", "AnthropicAgentAdapter"]
