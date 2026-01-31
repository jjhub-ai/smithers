"""
Request parsing for the Agent Runtime Protocol.

Requests come from Swift as NDJSON lines.
"""

import json
from dataclasses import dataclass
from typing import Any


@dataclass
class Request:
    """A protocol request from Swift."""

    id: str
    method: str
    params: dict[str, Any]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Request":
        return cls(
            id=data.get("id", ""),
            method=data["method"],
            params=data.get("params", {}),
        )


def parse_request(line: str) -> Request:
    """Parse an NDJSON line into a Request."""
    data = json.loads(line)
    return Request.from_dict(data)
