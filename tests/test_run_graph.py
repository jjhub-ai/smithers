"""Tests for graph execution with FakeLLMProvider."""

import pytest
from pydantic import BaseModel

from smithers import build_graph, claude, run_graph
from smithers.cache import SqliteCache
from smithers.errors import WorkflowError
from smithers.testing import FakeLLMProvider, use_fake_llm
from smithers.types import ExecutionResult
from smithers.workflow import require_approval, skip, workflow


class AnalysisOutput(BaseModel):
    files: list[str]
    summary: str


class ImplementOutput(BaseModel):
    changed_files: list[str]


class CodeCheckOutput(BaseModel):
    passed: bool
    report: str


class DeployOutput(BaseModel):
    url: str
    success: bool


class TestRunGraphBasic:
    """Basic execution tests."""

    async def test_single_workflow_execution(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude(
                "Analyze the codebase",
                output=AnalysisOutput,
            )

        fake = FakeLLMProvider(
            responses=[{"files": ["main.py", "utils.py"], "summary": "Found 2 Python files"}]
        )

        with use_fake_llm(fake):
            graph = build_graph(analyze)
            result = await run_graph(graph)

        assert isinstance(result, AnalysisOutput)
        assert result.files == ["main.py", "utils.py"]
        assert result.summary == "Found 2 Python files"
        assert len(fake.calls) == 1
        assert "Analyze the codebase" in fake.calls[0].prompt

    async def test_linear_dependency_execution(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return await claude(
                f"Implement fixes for: {analysis.files}",
                output=ImplementOutput,
            )

        fake = FakeLLMProvider(
            responses=[
                {"files": ["a.py"], "summary": "One file"},
                {"changed_files": ["a.py"]},
            ]
        )

        with use_fake_llm(fake):
            graph = build_graph(implement)
            result = await run_graph(graph)

        assert isinstance(result, ImplementOutput)
        assert result.changed_files == ["a.py"]
        assert len(fake.calls) == 2
        # Second call should include the analysis output
        assert "a.py" in fake.calls[1].prompt


class TestRunGraphParallel:
    """Tests for parallel execution."""

    async def test_parallel_branches_execute(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return await claude("Implement", output=ImplementOutput)

        @workflow
        async def test_code(impl: ImplementOutput) -> CodeCheckOutput:
            return await claude("Test", output=CodeCheckOutput)

        @workflow
        async def deploy(test_result: CodeCheckOutput) -> DeployOutput:
            return await claude("Deploy", output=DeployOutput)

        fake = FakeLLMProvider(
            responses=[
                {"files": ["a.py"], "summary": "OK"},
                {"changed_files": ["a.py"]},
                {"passed": True, "report": "All tests pass"},
                {"url": "https://example.com", "success": True},
            ]
        )

        with use_fake_llm(fake):
            graph = build_graph(deploy)
            result = await run_graph(graph)

        assert isinstance(result, DeployOutput)
        assert result.success is True
        assert result.url == "https://example.com"
        assert len(fake.calls) == 4


class TestRunGraphWithReturnAll:
    """Tests for return_all mode."""

    async def test_return_all_provides_execution_result(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return await claude("Implement", output=ImplementOutput)

        fake = FakeLLMProvider(
            responses=[
                {"files": ["x.py"], "summary": "Test"},
                {"changed_files": ["x.py"]},
            ]
        )

        with use_fake_llm(fake):
            graph = build_graph(implement)
            result = await run_graph(graph, return_all=True)

        assert isinstance(result, ExecutionResult)
        assert isinstance(result.output, ImplementOutput)
        assert "analyze" in result.outputs
        assert "implement" in result.outputs
        assert result.stats.workflows_executed == 2
        assert result.stats.workflows_cached == 0


class TestRunGraphCaching:
    """Tests for caching behavior."""

    async def test_cached_workflows_not_re_executed(self, tmp_path):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        cache_path = tmp_path / "cache.db"
        cache = SqliteCache(cache_path)

        # First run - should execute
        fake1 = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "First run"}])
        with use_fake_llm(fake1):
            graph = build_graph(analyze)
            result1 = await run_graph(graph, cache=cache)

        assert result1.summary == "First run"
        assert len(fake1.calls) == 1

        # Second run - should use cache
        fake2 = FakeLLMProvider(responses=[])  # No responses needed if cached
        with use_fake_llm(fake2):
            graph = build_graph(analyze)
            result2 = await run_graph(graph, cache=cache)

        assert result2.summary == "First run"  # Same as first run
        assert len(fake2.calls) == 0  # No LLM calls made

    async def test_invalidation_forces_re_execution(self, tmp_path):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        cache_path = tmp_path / "cache.db"
        cache = SqliteCache(cache_path)

        # First run
        fake1 = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "First run"}])
        with use_fake_llm(fake1):
            graph = build_graph(analyze)
            await run_graph(graph, cache=cache)

        # Second run with invalidation
        fake2 = FakeLLMProvider(responses=[{"files": ["b.py"], "summary": "Second run"}])
        with use_fake_llm(fake2):
            graph = build_graph(analyze)
            result = await run_graph(graph, cache=cache, invalidate="analyze")

        assert result.summary == "Second run"
        assert len(fake2.calls) == 1


class TestRunGraphSkip:
    """Tests for skip functionality."""

    async def test_skip_short_circuits_workflow(self):
        @workflow
        async def maybe_deploy() -> DeployOutput | None:
            # This workflow skips without calling claude
            return skip("Not ready for deployment")

        # No responses needed - skip happens before LLM call
        fake = FakeLLMProvider(responses=[])

        with use_fake_llm(fake):
            graph = build_graph(maybe_deploy)
            result = await run_graph(graph)

        assert result is None
        assert len(fake.calls) == 0


class TestRunGraphDryRun:
    """Tests for dry run mode."""

    async def test_dry_run_returns_plan_without_executing(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return await claude("Implement", output=ImplementOutput)

        # No responses needed for dry run
        fake = FakeLLMProvider(responses=[])

        with use_fake_llm(fake):
            graph = build_graph(implement)
            plan = await run_graph(graph, dry_run=True)

        assert plan.workflows == ["analyze", "implement"]
        assert plan.levels == [["analyze"], ["implement"]]
        assert len(fake.calls) == 0  # No LLM calls made


class TestRunGraphErrors:
    """Tests for error handling."""

    async def test_workflow_error_provides_context(self):
        @workflow
        async def failing() -> AnalysisOutput:
            raise ValueError("Something went wrong")

        # No responses needed - error happens in workflow
        fake = FakeLLMProvider(responses=[])

        with use_fake_llm(fake):
            graph = build_graph(failing)
            with pytest.raises(WorkflowError) as exc_info:
                await run_graph(graph)

        assert exc_info.value.workflow_name == "failing"
        assert "Something went wrong" in str(exc_info.value)

    async def test_exhausted_fake_provider_raises(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        # Empty responses list
        fake = FakeLLMProvider(responses=[])

        with use_fake_llm(fake):
            graph = build_graph(analyze)
            with pytest.raises(WorkflowError) as exc_info:
                await run_graph(graph)

        # The underlying error should mention exhausted provider
        assert "exhausted" in str(exc_info.value.cause).lower()


class TestRunGraphApproval:
    """Tests for approval workflow."""

    async def test_auto_approve_allows_execution(self):
        @workflow
        @require_approval("Deploy to production?")
        async def deploy() -> DeployOutput:
            return await claude("Deploy", output=DeployOutput)

        fake = FakeLLMProvider(responses=[{"url": "https://prod.example.com", "success": True}])

        with use_fake_llm(fake):
            graph = build_graph(deploy)
            result = await run_graph(graph, auto_approve=True)

        assert result.success is True
        assert len(fake.calls) == 1

    async def test_approval_handler_can_approve(self):
        @workflow
        @require_approval("Deploy to production?")
        async def deploy() -> DeployOutput:
            return await claude("Deploy", output=DeployOutput)

        async def always_approve(name: str, message: str) -> bool:
            return True

        fake = FakeLLMProvider(responses=[{"url": "https://prod.example.com", "success": True}])

        with use_fake_llm(fake):
            graph = build_graph(deploy)
            result = await run_graph(graph, approval_handler=always_approve)

        assert result.success is True

    async def test_approval_handler_can_reject(self):
        @workflow
        @require_approval("Deploy to production?")
        async def deploy() -> DeployOutput:
            return await claude("Deploy", output=DeployOutput)

        async def always_reject(name: str, message: str) -> bool:
            return False

        fake = FakeLLMProvider(responses=[])

        with use_fake_llm(fake):
            graph = build_graph(deploy)
            result = await run_graph(
                graph,
                approval_handler=always_reject,
                on_rejection="skip",
            )

        assert result is None
        assert len(fake.calls) == 0  # LLM never called due to rejection


class TestFakeLLMProviderIntrospection:
    """Tests for inspecting fake LLM provider calls."""

    async def test_calls_capture_prompt_and_output_type(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude(
                "Analyze the Python codebase",
                output=AnalysisOutput,
                tools=["Read", "Grep"],
                system="You are a code analyzer",
            )

        fake = FakeLLMProvider(responses=[{"files": ["test.py"], "summary": "Test file found"}])

        with use_fake_llm(fake):
            graph = build_graph(analyze)
            await run_graph(graph)

        assert len(fake.calls) == 1
        call = fake.calls[0]
        assert call.prompt == "Analyze the Python codebase"
        assert call.output_type == AnalysisOutput
        assert call.tools == ["Read", "Grep"]
        assert call.system == "You are a code analyzer"

    async def test_provider_reset_clears_state(self):
        fake = FakeLLMProvider(
            responses=[
                {"files": ["a.py"], "summary": "First"},
                {"files": ["b.py"], "summary": "Second"},
            ]
        )

        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        with use_fake_llm(fake):
            graph = build_graph(analyze)
            await run_graph(graph)

        assert len(fake.calls) == 1
        assert fake._index == 1

        fake.reset()

        assert len(fake.calls) == 0
        assert fake._index == 0

        with use_fake_llm(fake):
            graph = build_graph(analyze)
            result = await run_graph(graph)

        # Should use first response again after reset
        assert result.summary == "First"
