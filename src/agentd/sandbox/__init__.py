"""
Sandbox runtime abstraction.

Provides:
- HostRuntime: MVP, workspace-constrained host execution
- LinuxVMRuntime: Future, full VM isolation
"""

from agentd.sandbox.base import SandboxRuntime
from agentd.sandbox.host import HostRuntime

__all__ = ["HostRuntime", "SandboxRuntime"]
