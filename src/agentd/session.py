"""
Session and SessionManager for agentd.

Each session represents an agent conversation with its own
graph state, checkpoints, and tool execution context.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from agentd.adapters.base import AgentAdapter
from agentd.protocol.events import Event, EventType


@dataclass
class Session:
    """An agent session with its state."""

    id: str
    workspace_root: str
    created_at: datetime = field(default_factory=datetime.now)
    current_run_id: str | None = None
    message_history: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def create(cls, workspace_root: str) -> "Session":
        return cls(
            id=str(uuid.uuid4()),
            workspace_root=workspace_root,
        )


class SessionManager:
    """Manages multiple concurrent sessions."""

    def __init__(self, adapter: AgentAdapter, config: Any = None):
        """Initialize the session manager with an agent adapter.

        Args:
            adapter: The agent adapter to use for running conversations
            config: Optional configuration object (for future use)
        """
        self.adapter = adapter
        self.config = config
        self.sessions: dict[str, Session] = {}

    async def create_session(self, workspace_root: str) -> Session:
        """Create a new session."""
        session = Session.create(workspace_root)
        self.sessions[session.id] = session
        return session

    async def send_message(
        self,
        session_id: str,
        message: str,
        surfaces: list[str] | None = None,
        emit: Callable[[Event], None] | None = None,
    ) -> None:
        """Send a user message to start/continue a run.

        Args:
            session_id: ID of the session to send message to
            message: User message text
            surfaces: Optional list of surface IDs (for future use)
            emit: Optional callback for events (for testing)
        """
        session = self.sessions.get(session_id)
        if not session:
            if emit:
                emit(
                    Event(
                        type=EventType.ERROR, data={"message": f"Session not found: {session_id}"}
                    )
                )
            return

        run_id = str(uuid.uuid4())
        session.current_run_id = run_id

        if emit:
            emit(
                Event(type=EventType.RUN_STARTED, data={"run_id": run_id, "session_id": session_id})
            )

        # Add user message to history
        session.message_history.append({"role": "user", "content": message})

        # Run the agent through the adapter
        await self._run_agent(session, surfaces or [], emit)

        if emit:
            emit(
                Event(
                    type=EventType.RUN_FINISHED, data={"run_id": run_id, "session_id": session_id}
                )
            )

    async def _run_agent(
        self,
        session: Session,
        surfaces: list[str],
        emit: Callable[[Event], None] | None = None,
    ) -> None:
        """Run the agent using the configured adapter.

        Args:
            session: The session to run in
            surfaces: List of surface IDs (for future use)
            emit: Optional callback for events
        """
        # Build tool specs (empty for now, will be populated from surfaces)
        tools: list[dict[str, Any]] = []

        # Run the adapter with current message history
        async for _ in self.adapter.run(
            messages=session.message_history, tools=tools, emit=emit or (lambda e: None)
        ):
            # Events are already emitted by the adapter via the emit callback
            # We just consume the async iterator
            pass

    async def cancel_run(self, run_id: str) -> None:
        """Cancel a running agent."""
        for session in self.sessions.values():
            if session.current_run_id == run_id:
                session.current_run_id = None
                break
