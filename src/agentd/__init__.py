"""
agentd: The Smithers Agent Daemon

A long-running daemon that handles agent runtime protocol,
session management, and tool execution.
"""

__version__ = "0.1.0"

from agentd.daemon import AgentDaemon
from agentd.session import Session, SessionManager
from agentd.protocol.events import Event, EventType

__all__ = [
    "AgentDaemon",
    "Session",
    "SessionManager",
    "Event",
    "EventType",
]
