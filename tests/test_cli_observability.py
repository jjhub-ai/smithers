"""Tests for the observability CLI commands (watch, inspect, approve, runs)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from smithers.store.sqlite import NodeStatus, RunStatus, SqliteStore


@pytest.fixture
async def store_with_run(tmp_path: Path) -> tuple[Path, str]:
    """Create a store with a test run."""
    store_path = tmp_path / "test.db"
    store = SqliteStore(store_path)
    await store.initialize()

    # Create a run
    run_id = await store.create_run("test-plan-hash", "test_target", run_id="test-run-123")

    # Create some nodes
    await store.create_run_node(run_id, "analyze", "analyze", NodeStatus.SUCCESS)
    await store.create_run_node(run_id, "implement", "implement", NodeStatus.RUNNING)
    await store.create_run_node(run_id, "test", "test", NodeStatus.PENDING)

    # Update run status
    await store.update_run_status(run_id, RunStatus.RUNNING)

    # Add some events
    await store.emit_event(run_id, None, "RunStarted", {"target": "test_target"})
    await store.emit_event(run_id, "analyze", "NodeStarted", {})
    await store.emit_event(run_id, "analyze", "NodeFinished", {"duration_ms": 100})

    return store_path, run_id


class TestRunsCommand:
    """Tests for the `smithers runs` command."""

    async def test_runs_list_empty(self, tmp_path: Path) -> None:
        """Test listing runs when store is empty."""
        store_path = tmp_path / "empty.db"
        store = SqliteStore(store_path)
        await store.initialize()

        result = subprocess.run(
            [sys.executable, "-m", "smithers.cli", "runs", str(store_path)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "No runs found" in result.stdout

    async def test_runs_list_with_runs(self, store_with_run: tuple[Path, str]) -> None:
        """Test listing runs when runs exist."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [sys.executable, "-m", "smithers.cli", "runs", str(store_path)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert run_id in result.stdout
        assert "RUNNING" in result.stdout

    async def test_runs_list_json_format(self, store_with_run: tuple[Path, str]) -> None:
        """Test listing runs in JSON format."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [sys.executable, "-m", "smithers.cli", "runs", str(store_path), "--format", "json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        runs = json.loads(result.stdout)
        assert len(runs) >= 1
        assert runs[0]["run_id"] == run_id
        assert runs[0]["status"] == "RUNNING"

    async def test_runs_list_filter_by_status(self, store_with_run: tuple[Path, str]) -> None:
        """Test filtering runs by status."""
        store_path, _ = store_with_run

        # Filter by RUNNING should find the run
        result = subprocess.run(
            [sys.executable, "-m", "smithers.cli", "runs", str(store_path), "--status", "RUNNING"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "test-run-123" in result.stdout

        # Filter by SUCCESS should not find the run
        result = subprocess.run(
            [sys.executable, "-m", "smithers.cli", "runs", str(store_path), "--status", "SUCCESS"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "No runs found" in result.stdout


class TestInspectCommand:
    """Tests for the `smithers inspect` command."""

    async def test_inspect_run(self, store_with_run: tuple[Path, str]) -> None:
        """Test inspecting a run."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [sys.executable, "-m", "smithers.cli", "inspect", str(store_path), "--run", run_id],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert run_id in result.stdout
        assert "analyze" in result.stdout
        assert "implement" in result.stdout
        assert "test" in result.stdout

    async def test_inspect_run_json_format(self, store_with_run: tuple[Path, str]) -> None:
        """Test inspecting a run in JSON format."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "inspect",
                str(store_path),
                "--run",
                run_id,
                "--format",
                "json",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["run_id"] == run_id
        assert data["status"] == "RUNNING"
        assert len(data["nodes"]) == 3

    async def test_inspect_specific_node(self, store_with_run: tuple[Path, str]) -> None:
        """Test inspecting a specific node."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "inspect",
                str(store_path),
                "--run",
                run_id,
                "--node",
                "analyze",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "analyze" in result.stdout
        assert "SUCCESS" in result.stdout

    async def test_inspect_nonexistent_run(self, store_with_run: tuple[Path, str]) -> None:
        """Test inspecting a nonexistent run."""
        store_path, _ = store_with_run

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "inspect",
                str(store_path),
                "--run",
                "nonexistent",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "Run not found" in result.stderr


class TestApproveCommand:
    """Tests for the `smithers approve` command."""

    async def test_approve_requires_yes_or_no(self, store_with_run: tuple[Path, str]) -> None:
        """Test that approve requires --yes or --no."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "approve",
                str(store_path),
                "--run",
                run_id,
                "--node",
                "test",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Must specify --yes or --no" in result.stderr

    async def test_approve_cannot_have_both_yes_and_no(
        self, store_with_run: tuple[Path, str]
    ) -> None:
        """Test that approve cannot have both --yes and --no."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "approve",
                str(store_path),
                "--run",
                run_id,
                "--node",
                "test",
                "--yes",
                "--no",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Cannot specify both --yes and --no" in result.stderr

    async def test_approve_pending_approval(self, tmp_path: Path) -> None:
        """Test approving a pending approval."""
        store_path = tmp_path / "approval.db"
        store = SqliteStore(store_path)
        await store.initialize()

        # Create a run with a pending approval
        run_id = await store.create_run("test-hash", "test_target", run_id="approval-run")
        await store.request_approval(run_id, "deploy", "Deploy to production?")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "approve",
                str(store_path),
                "--run",
                run_id,
                "--node",
                "deploy",
                "--yes",
                "--user",
                "test_user",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "Approved" in result.stdout

        # Verify approval was recorded
        approval = await store.get_approval(run_id, "deploy")
        assert approval is not None
        assert approval.status == "APPROVED"
        assert approval.decided_by == "test_user"

    async def test_reject_pending_approval(self, tmp_path: Path) -> None:
        """Test rejecting a pending approval."""
        store_path = tmp_path / "reject.db"
        store = SqliteStore(store_path)
        await store.initialize()

        # Create a run with a pending approval
        run_id = await store.create_run("test-hash", "test_target", run_id="reject-run")
        await store.request_approval(run_id, "deploy", "Deploy to production?")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "approve",
                str(store_path),
                "--run",
                run_id,
                "--node",
                "deploy",
                "--no",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "Rejected" in result.stdout

        # Verify rejection was recorded
        approval = await store.get_approval(run_id, "deploy")
        assert approval is not None
        assert approval.status == "REJECTED"

    async def test_approve_nonexistent_approval(self, store_with_run: tuple[Path, str]) -> None:
        """Test approving a nonexistent approval."""
        store_path, run_id = store_with_run

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "approve",
                str(store_path),
                "--run",
                run_id,
                "--node",
                "nonexistent",
                "--yes",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "No pending approval" in result.stderr


class TestWatchCommand:
    """Tests for the `smithers watch` command."""

    async def test_watch_nonexistent_store(self, tmp_path: Path) -> None:
        """Test watching a nonexistent store."""
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "watch",
                str(tmp_path / "nonexistent.db"),
                "--run",
                "test",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Store not found" in result.stderr

    async def test_watch_nonexistent_run(self, store_with_run: tuple[Path, str]) -> None:
        """Test watching a nonexistent run."""
        store_path, _ = store_with_run

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "watch",
                str(store_path),
                "--run",
                "nonexistent",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert result.returncode != 0
        assert "Run not found" in result.stderr


class TestCLIStoreNotFound:
    """Tests for error handling when store is not found."""

    def test_runs_store_not_found(self, tmp_path: Path) -> None:
        """Test runs command with nonexistent store."""
        result = subprocess.run(
            [sys.executable, "-m", "smithers.cli", "runs", str(tmp_path / "nonexistent.db")],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Store not found" in result.stderr

    def test_inspect_store_not_found(self, tmp_path: Path) -> None:
        """Test inspect command with nonexistent store."""
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "inspect",
                str(tmp_path / "nonexistent.db"),
                "--run",
                "test",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Store not found" in result.stderr

    def test_approve_store_not_found(self, tmp_path: Path) -> None:
        """Test approve command with nonexistent store."""
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "approve",
                str(tmp_path / "nonexistent.db"),
                "--run",
                "test",
                "--node",
                "test",
                "--yes",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Store not found" in result.stderr
