"""Tests for the agentd daemon."""

import pytest
import json
import asyncio
from io import StringIO

from agentd.daemon import AgentDaemon, DaemonConfig
from agentd.protocol.events import EventType


class TestAgentDaemon:
    """Test the agent daemon."""

    @pytest.fixture
    def config(self, tmp_path):
        return DaemonConfig(
            workspace_root=str(tmp_path),
            sandbox_mode="host",
            agent_backend="fake",
        )

    @pytest.fixture
    def streams(self):
        return StringIO(), StringIO()

    def test_daemon_emits_ready_event(self, config, streams):
        """Daemon should emit ready event on start."""
        input_stream, output_stream = streams

        # Send EOF to stop the daemon
        input_stream.write("")
        input_stream.seek(0)

        daemon = AgentDaemon(config, input_stream, output_stream)

        async def run():
            await daemon.run()

        asyncio.run(run())

        output_stream.seek(0)
        lines = output_stream.read().strip().split("\n")

        assert len(lines) >= 1
        event = json.loads(lines[0])
        assert event["type"] == "daemon.ready"
        assert event["data"]["version"] == "0.1.0"


class TestProtocolEvents:
    """Test protocol event serialization."""

    def test_event_serialization(self):
        from agentd.protocol.events import Event, EventType

        event = Event(
            type=EventType.ASSISTANT_DELTA,
            data={"text": "Hello, world!"},
        )

        d = event.to_dict()
        assert d["type"] == "assistant.delta"
        assert d["data"]["text"] == "Hello, world!"
        assert "timestamp" in d


class TestHostRuntime:
    """Test the host sandbox runtime."""

    @pytest.fixture
    def runtime(self):
        from agentd.sandbox.host import HostRuntime

        return HostRuntime()

    @pytest.mark.asyncio
    async def test_create_sandbox(self, runtime, tmp_path):
        sandbox_id = await runtime.create_sandbox(tmp_path)
        assert sandbox_id is not None
        assert sandbox_id in runtime.sandboxes

    @pytest.mark.asyncio
    async def test_path_escape_blocked(self, runtime, tmp_path):
        sandbox_id = await runtime.create_sandbox(tmp_path)

        with pytest.raises(PermissionError, match="Path escape blocked"):
            await runtime.read_file(sandbox_id, tmp_path / ".." / "etc" / "passwd")

    @pytest.mark.asyncio
    async def test_exec_in_workspace(self, runtime, tmp_path):
        sandbox_id = await runtime.create_sandbox(tmp_path)

        result = await runtime.exec(sandbox_id, ["pwd"])
        assert result.exit_code == 0
        assert str(tmp_path) in result.stdout

    @pytest.mark.asyncio
    async def test_read_write_file(self, runtime, tmp_path):
        sandbox_id = await runtime.create_sandbox(tmp_path)

        test_file = tmp_path / "test.txt"
        await runtime.write_file(sandbox_id, test_file, "Hello, world!")

        content = await runtime.read_file(sandbox_id, test_file)
        assert content == "Hello, world!"
