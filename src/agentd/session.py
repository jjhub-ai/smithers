"""
Session and SessionManager for agentd.

Each session represents an agent conversation with its own
graph state, checkpoints, and tool execution context.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from agentd.protocol.events import Event, EventType


@dataclass
class Session:
    """An agent session with its state."""

    id: str
    workspace_root: str
    created_at: datetime = field(default_factory=datetime.now)
    current_run_id: str | None = None

    @classmethod
    def create(cls, workspace_root: str) -> "Session":
        return cls(
            id=str(uuid.uuid4()),
            workspace_root=workspace_root,
        )


class SessionManager:
    """Manages multiple concurrent sessions."""

    def __init__(self, config):
        self.config = config
        self.sessions: dict[str, Session] = {}
        self._adapter = None  # Will be set based on config

    async def create_session(self, workspace_root: str) -> Session:
        """Create a new session."""
        session = Session.create(workspace_root)
        self.sessions[session.id] = session
        return session

    async def send_message(
        self,
        session_id: str,
        message: str,
        surfaces: list,
        emit: Callable[[Event], None],
    ) -> None:
        """Send a user message to start/continue a run."""
        session = self.sessions.get(session_id)
        if not session:
            emit(Event(type=EventType.ERROR, data={"message": f"Session not found: {session_id}"}))
            return

        run_id = str(uuid.uuid4())
        session.current_run_id = run_id

        emit(Event(type=EventType.RUN_STARTED, data={"run_id": run_id, "session_id": session_id}))

        # TODO: Actually run the agent
        # For now, emit a fake response
        await self._run_agent(session, message, surfaces, emit)

        emit(Event(type=EventType.RUN_FINISHED, data={"run_id": run_id, "session_id": session_id}))

    async def _run_agent(
        self,
        session: Session,
        message: str,
        surfaces: list,
        emit: Callable[[Event], None],
    ) -> None:
        """Run the agent (will be implemented by adapters)."""
        # Placeholder: emit streaming response
        import asyncio

        emit(Event(type=EventType.ASSISTANT_DELTA, data={"text": "I'm analyzing your request"}))
        await asyncio.sleep(0.1)

        emit(Event(type=EventType.ASSISTANT_DELTA, data={"text": "..."}))
        await asyncio.sleep(0.1)

        emit(Event(type=EventType.ASSISTANT_FINAL, data={"message_id": str(uuid.uuid4())}))

    async def cancel_run(self, run_id: str) -> None:
        """Cancel a running agent."""
        for session in self.sessions.values():
            if session.current_run_id == run_id:
                session.current_run_id = None
                break
