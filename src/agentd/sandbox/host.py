"""
Host runtime - MVP sandbox with workspace containment.

NOT real security - just prevents accidental damage outside workspace.
"""

import asyncio
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from agentd.sandbox.base import ExecResult, SandboxRuntime


@dataclass
class HostSandbox:
    """A host sandbox instance."""

    id: str
    workspace_root: Path
    allowed_paths: set[Path] = field(default_factory=set)


class HostRuntime(SandboxRuntime):
    """
    Host-based sandbox with workspace containment.

    Security model (MVP):
    - All paths must resolve within workspace_root
    - Symlinks pointing outside are blocked
    - Environment is controlled (no secrets leak)
    - CWD is always within workspace
    """

    def __init__(self):
        self.sandboxes: dict[str, HostSandbox] = {}

    def _resolve_path(self, sandbox: HostSandbox, path: Path) -> Path:
        """Resolve and validate a path is within workspace."""
        # Make absolute
        if not path.is_absolute():
            path = sandbox.workspace_root / path

        # Resolve symlinks and normalize
        try:
            resolved = path.resolve(strict=False)
        except (OSError, ValueError) as e:
            raise PermissionError(f"Invalid path: {path}") from e

        # Check it's within workspace
        try:
            resolved.relative_to(sandbox.workspace_root.resolve())
        except ValueError:
            raise PermissionError(
                f"Path escape blocked: {path} -> {resolved} (outside {sandbox.workspace_root})"
            )

        return resolved

    async def create_sandbox(self, workspace_root: Path) -> str:
        """Create a host sandbox."""
        sandbox_id = str(uuid.uuid4())
        workspace = Path(workspace_root).resolve()

        if not workspace.exists():
            raise ValueError(f"Workspace does not exist: {workspace}")

        self.sandboxes[sandbox_id] = HostSandbox(
            id=sandbox_id,
            workspace_root=workspace,
        )
        return sandbox_id

    async def exec(
        self,
        sandbox_id: str,
        command: list[str],
        cwd: Optional[Path] = None,
        env: Optional[dict[str, str]] = None,
    ) -> ExecResult:
        """Execute command with workspace containment."""
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise ValueError(f"Sandbox not found: {sandbox_id}")

        # Resolve cwd
        exec_cwd = sandbox.workspace_root
        if cwd:
            exec_cwd = self._resolve_path(sandbox, cwd)

        # Build safe environment
        safe_env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(sandbox.workspace_root),
            "TERM": "xterm-256color",
            "LANG": "en_US.UTF-8",
        }
        if env:
            safe_env.update(env)

        # Execute
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=exec_cwd,
            env=safe_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await proc.communicate()

        return ExecResult(
            exit_code=proc.returncode or 0,
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
        )

    async def read_file(self, sandbox_id: str, path: Path) -> str:
        """Read file with path validation."""
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise ValueError(f"Sandbox not found: {sandbox_id}")

        resolved = self._resolve_path(sandbox, path)
        return resolved.read_text()

    async def write_file(self, sandbox_id: str, path: Path, content: str) -> None:
        """Write file with path validation."""
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise ValueError(f"Sandbox not found: {sandbox_id}")

        resolved = self._resolve_path(sandbox, path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content)

    async def attach_terminal(self, sandbox_id: str) -> str:
        """Get PTY endpoint - returns workspace root for terminal cwd."""
        sandbox = self.sandboxes.get(sandbox_id)
        if not sandbox:
            raise ValueError(f"Sandbox not found: {sandbox_id}")

        # For MVP, just return the workspace root
        # Full PTY implementation would spawn a shell and return a pty path
        return str(sandbox.workspace_root)

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        """Clean up sandbox state."""
        if sandbox_id in self.sandboxes:
            del self.sandboxes[sandbox_id]
