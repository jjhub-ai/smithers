"""
Agent Runtime Protocol definitions.

This module defines the NDJSON protocol between Swift and Python.
"""

from agentd.protocol.events import Event, EventType
from agentd.protocol.requests import Request, parse_request

__all__ = ["Event", "EventType", "Request", "parse_request"]
