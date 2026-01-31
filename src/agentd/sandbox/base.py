"""Base class for sandbox runtimes."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class ExecResult:
    """Result of executing a command in the sandbox."""

    exit_code: int
    stdout: str
    stderr: str


class SandboxRuntime(ABC):
    """
    Abstract sandbox runtime.

    All tool execution goes through this interface,
    allowing us to swap HostRuntime for LinuxVMRuntime later.
    """

    @abstractmethod
    async def create_sandbox(self, workspace_root: Path) -> str:
        """Create a new sandbox, return sandbox_id."""
        pass

    @abstractmethod
    async def exec(
        self,
        sandbox_id: str,
        command: list[str],
        cwd: Optional[Path] = None,
        env: Optional[dict[str, str]] = None,
    ) -> ExecResult:
        """Execute a command in the sandbox."""
        pass

    @abstractmethod
    async def read_file(self, sandbox_id: str, path: Path) -> str:
        """Read a file from the sandbox."""
        pass

    @abstractmethod
    async def write_file(self, sandbox_id: str, path: Path, content: str) -> None:
        """Write a file in the sandbox."""
        pass

    @abstractmethod
    async def attach_terminal(self, sandbox_id: str) -> str:
        """Get PTY endpoint for terminal attachment."""
        pass

    @abstractmethod
    async def destroy_sandbox(self, sandbox_id: str) -> None:
        """Clean up the sandbox."""
        pass
