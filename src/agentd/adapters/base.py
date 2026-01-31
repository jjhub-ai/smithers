"""Base class for agent adapters."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable
from typing import Any

from agentd.protocol.events import Event

type Message = dict[str, Any]
type ToolSpec = dict[str, Any]


class AgentAdapter(ABC):
    """
    Abstract base for agent backends.

    All adapters must translate their native events into
    our internal Event types.
    """

    @abstractmethod
    def run(
        self,
        messages: list[Message],
        tools: list[ToolSpec],
        emit: Callable[[Event], None],
    ) -> AsyncIterator[Event]:
        """
        Run the agent with given messages and tools.

        Yields events as they occur.
        """
        pass

    @abstractmethod
    async def cancel(self) -> None:
        """Cancel the current run."""
        pass
