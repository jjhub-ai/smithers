"""Tests for the resume functionality."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import BaseModel

from smithers import (
    PauseExecution,
    build_graph,
    resume_run,
    run_graph_with_store,
    workflow,
)
from smithers.store.sqlite import NodeStatus, RunStatus, SqliteStore
from smithers.testing import FakeLLMProvider, use_fake_llm
from smithers.workflow import clear_registry, require_approval


class StepOneOutput(BaseModel):
    value: int


class StepTwoOutput(BaseModel):
    doubled: int


class StepThreeOutput(BaseModel):
    final: int


@pytest.fixture(autouse=True)
def clear_workflow_registry():
    """Clear the workflow registry before each test."""
    clear_registry()


class TestPauseExecution:
    """Tests for PauseExecution exception."""

    async def test_headless_mode_pauses_on_approval(self, tmp_path: Path) -> None:
        """Test that headless mode raises PauseExecution when approval is required."""
        clear_registry()

        @workflow
        @require_approval("Proceed with step one?")
        async def step_one() -> StepOneOutput:
            return StepOneOutput(value=42)

        graph = build_graph(step_one)
        store = SqliteStore(tmp_path / "test.db")

        with pytest.raises(PauseExecution) as exc_info:
            with use_fake_llm(FakeLLMProvider()):
                await run_graph_with_store(graph, store=store, headless=True)

        assert exc_info.value.node_id == "step_one"
        assert "Proceed with step one?" in exc_info.value.message

        # Verify run is paused
        run = await store.get_run((await store.list_runs())[0].run_id)
        assert run is not None
        assert run.status == RunStatus.PAUSED

    async def test_headless_mode_pauses_node_status(self, tmp_path: Path) -> None:
        """Test that the node status is set to PAUSED in headless mode."""
        clear_registry()

        @workflow
        @require_approval("Approve?")
        async def approval_workflow() -> StepOneOutput:
            return StepOneOutput(value=1)

        graph = build_graph(approval_workflow)
        store = SqliteStore(tmp_path / "test.db")

        try:
            with use_fake_llm(FakeLLMProvider()):
                await run_graph_with_store(graph, store=store, headless=True)
        except PauseExecution:
            pass

        runs = await store.list_runs()
        nodes = await store.get_run_nodes(runs[0].run_id)
        assert any(n.status == NodeStatus.PAUSED for n in nodes)


class TestNodeOutputStorage:
    """Tests for node output storage and retrieval."""

    async def test_store_node_output(self, tmp_path: Path) -> None:
        """Test that node outputs are stored in the database."""
        store = SqliteStore(tmp_path / "store.db")
        await store.initialize()

        run_id = await store.create_run("test-hash", "target", run_id="test-run")
        await store.store_node_output(run_id, "node1", {"value": 42})

        output = await store.get_node_output(run_id, "node1")
        assert output == {"value": 42}

    async def test_get_all_node_outputs(self, tmp_path: Path) -> None:
        """Test retrieving all node outputs for a run."""
        store = SqliteStore(tmp_path / "store.db")
        await store.initialize()

        run_id = await store.create_run("test-hash", "target", run_id="test-run")
        await store.store_node_output(run_id, "node1", {"value": 1})
        await store.store_node_output(run_id, "node2", {"value": 2})
        await store.store_node_output(run_id, "node3", {"value": 3})

        outputs = await store.get_all_node_outputs(run_id)
        assert outputs == {
            "node1": {"value": 1},
            "node2": {"value": 2},
            "node3": {"value": 3},
        }

    async def test_clear_node_outputs(self, tmp_path: Path) -> None:
        """Test clearing node outputs."""
        store = SqliteStore(tmp_path / "store.db")
        await store.initialize()

        run_id = await store.create_run("test-hash", "target", run_id="test-run")
        await store.store_node_output(run_id, "node1", {"value": 1})
        await store.store_node_output(run_id, "node2", {"value": 2})

        deleted = await store.clear_node_outputs(run_id)
        assert deleted == 2

        outputs = await store.get_all_node_outputs(run_id)
        assert outputs == {}


class TestResumeRun:
    """Tests for the resume_run function."""

    async def test_resume_validates_run_exists(self, tmp_path: Path) -> None:
        """Test that resume_run raises if run doesn't exist."""
        clear_registry()

        @workflow
        async def simple_workflow() -> StepOneOutput:
            return StepOneOutput(value=1)

        graph = build_graph(simple_workflow)
        store = SqliteStore(tmp_path / "store.db")
        await store.initialize()

        with pytest.raises(ValueError, match="Run not found"):
            await resume_run("nonexistent-run", store, graph)

    async def test_resume_validates_paused_status(self, tmp_path: Path) -> None:
        """Test that resume_run raises if run is not paused."""
        clear_registry()

        @workflow
        async def simple_workflow() -> StepOneOutput:
            return StepOneOutput(value=1)

        graph = build_graph(simple_workflow)
        store = SqliteStore(tmp_path / "store.db")
        await store.initialize()

        run_id = await store.create_run("test-hash", "simple_workflow", run_id="test-run")
        await store.update_run_status(run_id, RunStatus.RUNNING)

        with pytest.raises(ValueError, match="Run is not paused"):
            await resume_run(run_id, store, graph)

    async def test_resume_validates_no_pending_approvals(self, tmp_path: Path) -> None:
        """Test that resume_run raises if there are pending approvals."""
        clear_registry()

        @workflow
        async def simple_workflow() -> StepOneOutput:
            return StepOneOutput(value=1)

        graph = build_graph(simple_workflow)
        store = SqliteStore(tmp_path / "store.db")
        await store.initialize()

        run_id = await store.create_run("test-hash", "simple_workflow", run_id="test-run")
        await store.update_run_status(run_id, RunStatus.PAUSED)
        await store.request_approval(run_id, "simple_workflow", "Approve?")

        with pytest.raises(ValueError, match="pending approvals"):
            await resume_run(run_id, store, graph)

    async def test_resume_after_approval(self, tmp_path: Path) -> None:
        """Test that a paused run can be resumed after approval."""
        clear_registry()
        executed = {"step_one": False, "step_two": False}

        @workflow
        @require_approval("Approve step one?")
        async def step_one() -> StepOneOutput:
            executed["step_one"] = True
            return StepOneOutput(value=42)

        @workflow
        async def step_two(dep: StepOneOutput) -> StepTwoOutput:
            executed["step_two"] = True
            return StepTwoOutput(doubled=dep.value * 2)

        graph = build_graph(step_two)
        store = SqliteStore(tmp_path / "store.db")

        # First run - should pause at approval
        try:
            with use_fake_llm(FakeLLMProvider()):
                await run_graph_with_store(graph, store=store, headless=True)
        except PauseExecution:
            pass

        runs = await store.list_runs()
        run_id = runs[0].run_id

        # Approve the node
        await store.decide_approval(run_id, "step_one", approved=True)

        # Resume the run
        with use_fake_llm(FakeLLMProvider()):
            result = await resume_run(run_id, store, graph)

        assert result is not None
        assert result.doubled == 84
        assert executed["step_one"]
        assert executed["step_two"]

        # Verify run is now successful
        run = await store.get_run(run_id)
        assert run is not None
        assert run.status == RunStatus.SUCCESS


class TestResumeRunCLI:
    """Tests for the CLI resume command."""

    async def test_resume_store_not_found(self, tmp_path: Path) -> None:
        """Test resume command with nonexistent store."""
        workflow_file = tmp_path / "workflow.py"
        workflow_file.write_text("""
from pydantic import BaseModel
from smithers import workflow

class Output(BaseModel):
    value: int

@workflow
async def test_workflow() -> Output:
    return Output(value=1)
""")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "resume",
                str(tmp_path / "nonexistent.db"),
                "--run",
                "test-run",
                str(workflow_file),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "Store not found" in result.stderr

    async def test_resume_run_not_found(self, tmp_path: Path) -> None:
        """Test resume command with nonexistent run."""
        store_path = tmp_path / "test.db"
        store = SqliteStore(store_path)
        await store.initialize()

        workflow_file = tmp_path / "workflow.py"
        workflow_file.write_text("""
from pydantic import BaseModel
from smithers import workflow

class Output(BaseModel):
    value: int

@workflow
async def test_workflow() -> Output:
    return Output(value=1)
""")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "resume",
                str(store_path),
                "--run",
                "nonexistent-run",
                str(workflow_file),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "Run not found" in result.stderr

    async def test_resume_run_not_paused(self, tmp_path: Path) -> None:
        """Test resume command with run that is not paused."""
        store_path = tmp_path / "test.db"
        store = SqliteStore(store_path)
        await store.initialize()

        run_id = await store.create_run("test-hash", "test_workflow", run_id="test-run")
        await store.update_run_status(run_id, RunStatus.RUNNING)

        workflow_file = tmp_path / "workflow.py"
        workflow_file.write_text("""
from pydantic import BaseModel
from smithers import workflow

class Output(BaseModel):
    value: int

@workflow
async def test_workflow() -> Output:
    return Output(value=1)
""")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "resume",
                str(store_path),
                "--run",
                "test-run",
                str(workflow_file),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "not paused" in result.stderr

    async def test_resume_with_pending_approvals(self, tmp_path: Path) -> None:
        """Test resume command with pending approvals."""
        store_path = tmp_path / "test.db"
        store = SqliteStore(store_path)
        await store.initialize()

        run_id = await store.create_run("test-hash", "test_workflow", run_id="test-run")
        await store.update_run_status(run_id, RunStatus.PAUSED)
        await store.request_approval(run_id, "test_workflow", "Approve?")

        workflow_file = tmp_path / "workflow.py"
        workflow_file.write_text("""
from pydantic import BaseModel
from smithers import workflow

class Output(BaseModel):
    value: int

@workflow
async def test_workflow() -> Output:
    return Output(value=1)
""")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "smithers.cli",
                "resume",
                str(store_path),
                "--run",
                "test-run",
                str(workflow_file),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "pending approval" in result.stderr.lower()


class TestPauseResumeIntegration:
    """Integration tests for the full pause/resume workflow."""

    async def test_multi_step_workflow_pause_resume(self, tmp_path: Path) -> None:
        """Test pausing and resuming a multi-step workflow."""
        clear_registry()
        execution_order: list[str] = []

        @workflow
        async def step_one() -> StepOneOutput:
            execution_order.append("step_one")
            return StepOneOutput(value=10)

        @workflow
        @require_approval("Continue to step two?")
        async def step_two(dep: StepOneOutput) -> StepTwoOutput:
            execution_order.append("step_two")
            return StepTwoOutput(doubled=dep.value * 2)

        @workflow
        async def step_three(dep: StepTwoOutput) -> StepThreeOutput:
            execution_order.append("step_three")
            return StepThreeOutput(final=dep.doubled + 1)

        graph = build_graph(step_three)
        store = SqliteStore(tmp_path / "store.db")

        # First run - should execute step_one then pause at step_two
        try:
            with use_fake_llm(FakeLLMProvider()):
                await run_graph_with_store(graph, store=store, headless=True)
        except PauseExecution:
            pass

        # Verify step_one executed
        assert execution_order == ["step_one"]

        runs = await store.list_runs()
        run_id = runs[0].run_id

        # Verify step_one output was stored
        outputs = await store.get_all_node_outputs(run_id)
        assert "step_one" in outputs
        assert outputs["step_one"]["value"] == 10

        # Approve step_two
        await store.decide_approval(run_id, "step_two", approved=True)

        # Resume the run
        execution_order.clear()
        with use_fake_llm(FakeLLMProvider()):
            result = await resume_run(run_id, store, graph)

        # Verify step_two and step_three executed (step_one should be skipped as it was already done)
        assert "step_two" in execution_order
        assert "step_three" in execution_order
        # step_one should NOT be in the list since it was already completed
        assert "step_one" not in execution_order

        assert result is not None
        assert result.final == 21  # (10 * 2) + 1

        # Verify run completed successfully
        run = await store.get_run(run_id)
        assert run is not None
        assert run.status == RunStatus.SUCCESS

    async def test_headless_mode_with_auto_approve(self, tmp_path: Path) -> None:
        """Test that auto_approve works in headless mode."""
        clear_registry()

        @workflow
        @require_approval("Approve?")
        async def approval_workflow() -> StepOneOutput:
            return StepOneOutput(value=42)

        graph = build_graph(approval_workflow)
        store = SqliteStore(tmp_path / "store.db")

        # Should not pause because auto_approve=True
        with use_fake_llm(FakeLLMProvider()):
            result = await run_graph_with_store(
                graph, store=store, headless=True, auto_approve=True
            )

        assert result is not None
        assert result.value == 42
