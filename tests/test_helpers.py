"""Tests for the testing helpers module."""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from smithers import workflow
from smithers.testing.helpers import (
    WorkflowTestCase,
    assert_graph_has_dependency,
    assert_graph_has_nodes,
    assert_graph_is_dag,
    assert_graph_levels,
    assert_workflow_depends_on,
    assert_workflow_produces,
    create_test_graph,
    mock_output,
)
from smithers.workflow import clear_registry


# Test models
class AnalysisOutput(BaseModel):
    files: list[str]
    summary: str


class ImplementOutput(BaseModel):
    changed_files: list[str]


class TestOutput(BaseModel):
    passed: bool
    count: int = 0


class DeployOutput(BaseModel):
    url: str


@pytest.fixture(autouse=True)
def clean_registry():
    """Clear the workflow registry before each test."""
    clear_registry()
    yield
    clear_registry()


class TestAssertGraphIsDag:
    """Tests for assert_graph_is_dag."""

    def test_valid_dag(self) -> None:
        """Test that a valid DAG passes the assertion."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        graph = create_test_graph(analyze, implement, target=implement)
        assert_graph_is_dag(graph)  # Should not raise


class TestAssertGraphHasNodes:
    """Tests for assert_graph_has_nodes."""

    def test_all_nodes_present(self) -> None:
        """Test assertion passes when all nodes are present."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        graph = create_test_graph(analyze, implement, target=implement)
        assert_graph_has_nodes(graph, "analyze", "implement")

    def test_missing_node_raises(self) -> None:
        """Test assertion fails when a node is missing."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        graph = create_test_graph(analyze)
        with pytest.raises(AssertionError, match="missing expected nodes"):
            assert_graph_has_nodes(graph, "analyze", "implement")


class TestAssertGraphHasDependency:
    """Tests for assert_graph_has_dependency."""

    def test_dependency_exists(self) -> None:
        """Test assertion passes when dependency exists."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        graph = create_test_graph(analyze, implement, target=implement)
        assert_graph_has_dependency(graph, "analyze", "implement")

    def test_missing_dependency_raises(self) -> None:
        """Test assertion fails when dependency is missing."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        graph = create_test_graph(analyze, implement, target=implement)
        with pytest.raises(AssertionError, match="to depend on"):
            assert_graph_has_dependency(graph, "implement", "analyze")  # Wrong direction

    def test_nonexistent_node_raises(self) -> None:
        """Test assertion fails when to_node doesn't exist."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        graph = create_test_graph(analyze)
        with pytest.raises(AssertionError, match="not found"):
            assert_graph_has_dependency(graph, "analyze", "nonexistent")


class TestAssertGraphLevels:
    """Tests for assert_graph_levels."""

    def test_correct_levels(self) -> None:
        """Test assertion passes with correct level structure."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        graph = create_test_graph(analyze, implement, target=implement)
        assert_graph_levels(graph, ["analyze"], ["implement"])

    def test_wrong_level_count_raises(self) -> None:
        """Test assertion fails with wrong level count."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        graph = create_test_graph(analyze)
        with pytest.raises(AssertionError, match="Expected 2 levels"):
            assert_graph_levels(graph, ["analyze"], ["extra"])

    def test_wrong_level_contents_raises(self) -> None:
        """Test assertion fails with wrong level contents."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        graph = create_test_graph(analyze)
        with pytest.raises(AssertionError, match="Level 0 mismatch"):
            assert_graph_levels(graph, ["wrong_name"])


class TestAssertWorkflowProduces:
    """Tests for assert_workflow_produces."""

    def test_correct_output_type(self) -> None:
        """Test assertion passes with correct output type."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        assert_workflow_produces(analyze, AnalysisOutput)

    def test_wrong_output_type_raises(self) -> None:
        """Test assertion fails with wrong output type."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        with pytest.raises(AssertionError, match="produces AnalysisOutput"):
            assert_workflow_produces(analyze, ImplementOutput)


class TestAssertWorkflowDependsOn:
    """Tests for assert_workflow_depends_on."""

    def test_correct_dependencies(self) -> None:
        """Test assertion passes with correct dependencies."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        assert_workflow_depends_on(implement, AnalysisOutput)

    def test_missing_dependency_raises(self) -> None:
        """Test assertion fails when dependency is missing."""
        @workflow
        async def standalone() -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        with pytest.raises(AssertionError, match="missing expected dependencies"):
            assert_workflow_depends_on(standalone, AnalysisOutput)


class TestMockOutput:
    """Tests for mock_output."""

    def test_with_all_fields(self) -> None:
        """Test creating a mock with all fields specified."""
        output = mock_output(
            AnalysisOutput,
            files=["a.py", "b.py"],
            summary="Test summary",
        )
        assert output.files == ["a.py", "b.py"]
        assert output.summary == "Test summary"

    def test_with_some_fields(self) -> None:
        """Test creating a mock with some fields specified."""
        output = mock_output(AnalysisOutput, files=["a.py"])
        assert output.files == ["a.py"]
        assert isinstance(output.summary, str)  # Auto-generated

    def test_with_defaults(self) -> None:
        """Test that defaults are used when available."""
        output = mock_output(TestOutput, passed=True)
        assert output.passed is True
        assert output.count == 0  # Default value

    def test_auto_generates_list(self) -> None:
        """Test that lists are auto-generated as empty."""
        output = mock_output(AnalysisOutput, summary="Test")
        assert output.files == []


class TestCreateTestGraph:
    """Tests for create_test_graph."""

    def test_single_workflow(self) -> None:
        """Test creating a graph with a single workflow."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        graph = create_test_graph(analyze)
        assert "analyze" in graph.nodes
        assert graph.root == "analyze"

    def test_multiple_workflows(self) -> None:
        """Test creating a graph with multiple workflows."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        graph = create_test_graph(analyze, implement)
        assert "analyze" in graph.nodes
        assert "implement" in graph.nodes
        assert graph.root == "implement"  # Last workflow

    def test_explicit_target(self) -> None:
        """Test creating a graph with explicit target."""
        @workflow
        async def analyze() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="")

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=[])

        graph = create_test_graph(analyze, implement, target=analyze)
        assert graph.root == "analyze"


class TestWorkflowTestCase:
    """Tests for WorkflowTestCase base class."""

    def test_create_fake_llm(self) -> None:
        """Test creating a fake LLM provider."""
        tc = WorkflowTestCase()
        fake = tc.create_fake_llm([{"files": ["a.py"], "summary": "Test"}])
        assert len(fake.responses) == 1

    def test_create_fake_llm_by_type(self) -> None:
        """Test creating a fake LLM provider with type-based responses."""
        tc = WorkflowTestCase()
        fake = tc.create_fake_llm_by_type({
            AnalysisOutput: {"files": ["a.py"], "summary": "Test"},
        })
        assert AnalysisOutput in fake.responses_by_type

    def test_use_fake_context_manager(self) -> None:
        """Test using the fake context manager."""
        tc = WorkflowTestCase()
        fake = tc.create_fake_llm([{"files": [], "summary": ""}])
        with tc.use_fake(fake):
            from smithers.testing.fakes import get_fake_llm_provider
            assert get_fake_llm_provider() is fake

    def test_use_runtime_context_manager(self) -> None:
        """Test using the runtime context manager."""
        tc = WorkflowTestCase()
        fake = tc.create_fake_llm([{"files": [], "summary": ""}])
        with tc.use_runtime(llm=fake):
            from smithers.testing.fakes import get_fake_llm_provider
            assert get_fake_llm_provider() is fake
