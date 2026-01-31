"""
Base classes for the skills system.

Skills are specialized agent actions that can be invoked by the UI.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any


class SkillMode(str, Enum):
    """Execution mode for a skill."""

    SIDE_ACTION = "side_action"  # Produces artifact, not appended to chat
    AGENT_RUN = "agent_run"  # Creates run nodes + optionally appends messages


@dataclass
class SkillContext:
    """
    Context available to skill execution.

    Provides access to workspace, session state, and selected nodes.
    """

    workspace_path: str
    session_id: str
    selected_node_id: str | None = None
    session_messages: list[dict[str, Any]] | None = None


@dataclass
class SkillResult:
    """Result of skill execution."""

    success: bool
    result: str  # Text result or artifact reference
    error: str | None = None


class Skill(ABC):
    """
    Base class for all skills.

    Each skill defines:
    - A unique ID
    - A display name
    - An execution mode (side action vs agent run)
    - Required inputs/surfaces
    - Execution logic
    """

    @property
    @abstractmethod
    def skill_id(self) -> str:
        """Unique identifier for this skill."""
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """Display name for this skill."""
        ...

    @property
    def description(self) -> str:
        """Optional description of what this skill does."""
        return ""

    @property
    def mode(self) -> SkillMode:
        """Execution mode for this skill. Defaults to side action."""
        return SkillMode.SIDE_ACTION

    @property
    def icon(self) -> str | None:
        """Optional icon name for UI display."""
        return None

    @abstractmethod
    async def execute(self, context: SkillContext, args: str | None = None) -> SkillResult:
        """
        Execute the skill with the given context and arguments.

        Args:
            context: Execution context with workspace, session, etc.
            args: Optional arguments passed from the UI

        Returns:
            SkillResult with success status and result text
        """
        ...
