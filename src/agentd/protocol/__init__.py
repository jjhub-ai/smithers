"""
Agent Runtime Protocol definitions.

This module defines the NDJSON protocol between Swift and Python.
"""

from agentd.protocol.events import Event, EventType
from agentd.protocol.requests import Request, parse_request
from agentd.protocol.validation import (
    PROTOCOL_VERSION,
    ValidationError,
    get_protocol_version,
    validate_event,
    validate_request,
)

__all__ = [
    "PROTOCOL_VERSION",
    "Event",
    "EventType",
    "Request",
    "ValidationError",
    "get_protocol_version",
    "parse_request",
    "validate_event",
    "validate_request",
]
