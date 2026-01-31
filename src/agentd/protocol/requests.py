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

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict."""
        return {
            "id": self.id,
            "method": self.method,
            "params": self.params,
        }

    def validate(self) -> None:
        """
        Validate this request against the protocol schema.

        Raises:
            ValidationError: If the request doesn't match the schema
        """
        from agentd.protocol.validation import validate_request

        validate_request(self.to_dict())


def parse_request(line: str) -> Request:
    """Parse an NDJSON line into a Request."""
    data = json.loads(line)
    return Request.from_dict(data)
