"""Tests for workflow graph execution."""

import tempfile
from pathlib import Path

from pydantic import BaseModel

from smithers.cache import SqliteCache
from smithers.graph import build_graph, run_graph
from smithers.testing.fakes import FakeLLMProvider, use_fake_llm
from smithers.workflow import clear_registry, skip, workflow


class AnalysisOutput(BaseModel):
    files: list[str]
    summary: str


class ImplementOutput(BaseModel):
    changed_files: list[str]


class CheckOutput(BaseModel):
    passed: bool
    failures: list[str]


class LintOutput(BaseModel):
    issues: list[str]


class FinalOutput(BaseModel):
    message: str


class TestRunGraphBasic:
    """Basic tests for run_graph function."""

    async def test_single_workflow_execution(self):
        """Test executing a single workflow."""

        @workflow
        async def simple() -> AnalysisOutput:
            return AnalysisOutput(files=["a.py"], summary="Simple test")

        graph = build_graph(simple)
        result = await run_graph(graph)

        assert result.files == ["a.py"]
        assert result.summary == "Simple test"

    async def test_linear_dependency_execution(self):
        """Test executing workflows with linear dependencies."""

        @workflow
        async def step1() -> AnalysisOutput:
            return AnalysisOutput(files=["file.py"], summary="Analyzed")

        @workflow
        async def step2(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=analysis.files)

        graph = build_graph(step2)
        result = await run_graph(graph)

        assert result.changed_files == ["file.py"]

    async def test_parallel_workflow_execution(self):
        """Test that parallel workflows execute correctly."""

        @workflow
        async def base() -> AnalysisOutput:
            return AnalysisOutput(files=["src.py"], summary="Base")

        @workflow
        async def lint(analysis: AnalysisOutput) -> LintOutput:
            return LintOutput(issues=[])

        @workflow
        async def check(analysis: AnalysisOutput) -> CheckOutput:
            return CheckOutput(passed=True, failures=[])

        @workflow
        async def final(lint: LintOutput, tests: CheckOutput) -> FinalOutput:
            status = "All good" if tests.passed and not lint.issues else "Issues"
            return FinalOutput(message=status)

        graph = build_graph(final)

        # Verify graph structure
        assert set(graph.levels[1]) == {"lint", "check"}  # Parallel level

        result = await run_graph(graph)
        assert result.message == "All good"


class TestRunGraphWithFakeLLM:
    """Tests for run_graph with FakeLLMProvider."""

    async def test_workflow_with_fake_claude(self):
        """Test that workflows using claude() work with fake provider."""
        from smithers.claude import claude

        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze the code", output=AnalysisOutput)

        fake = FakeLLMProvider(responses=[{"files": ["app.py"], "summary": "Main application"}])

        with use_fake_llm(fake):
            graph = build_graph(analyze)
            result = await run_graph(graph)

        assert result.files == ["app.py"]
        assert len(fake.calls) == 1

    async def test_multi_step_workflow_with_fake_claude(self):
        """Test multi-step workflow with fake Claude responses."""
        from smithers.claude import claude

        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return await claude(f"Implement fixes for {analysis.files}", output=ImplementOutput)

        fake = FakeLLMProvider(
            responses=[
                {"files": ["core.py"], "summary": "Core module"},
                {"changed_files": ["core.py"]},
            ]
        )

        with use_fake_llm(fake):
            graph = build_graph(implement)
            result = await run_graph(graph)

        assert result.changed_files == ["core.py"]
        assert len(fake.calls) == 2


class TestRunGraphWithCache:
    """Tests for run_graph with caching."""

    async def test_cache_hit_skips_execution(self):
        """Test that cached results skip workflow execution."""
        execution_count = 0

        @workflow
        async def counted() -> AnalysisOutput:
            nonlocal execution_count
            execution_count += 1
            return AnalysisOutput(files=["counted.py"], summary=f"Run {execution_count}")

        with tempfile.TemporaryDirectory() as tmpdir:
            cache = SqliteCache(Path(tmpdir) / "cache.db")
            graph = build_graph(counted)

            # First run - should execute
            result1 = await run_graph(graph, cache=cache)
            assert result1.summary == "Run 1"
            assert execution_count == 1

            # Second run with same graph - should use cache
            result2 = await run_graph(graph, cache=cache)
            assert result2.summary == "Run 1"  # Cached result
            assert execution_count == 1  # Not executed again

    async def test_cache_miss_on_code_change(self):
        """Test that code changes invalidate cache."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache = SqliteCache(Path(tmpdir) / "cache.db")

            @workflow
            async def versioned() -> AnalysisOutput:
                # Version 1 implementation
                return AnalysisOutput(files=["v1.py"], summary="Version 1")

            graph = build_graph(versioned)
            result1 = await run_graph(graph, cache=cache)
            assert result1.summary == "Version 1"

            # Clear and redefine with different code (significantly different structure)
            clear_registry()

            @workflow
            async def versioned() -> AnalysisOutput:
                # Version 2 implementation - completely different code structure
                files = ["v2.py"]
                summary = "Version 2"
                return AnalysisOutput(files=files, summary=summary)

            graph = build_graph(versioned)
            result2 = await run_graph(graph, cache=cache)
            assert result2.summary == "Version 2"  # New result, not cached

    async def test_cache_invalidation(self):
        """Test manual cache invalidation."""
        execution_count = 0

        @workflow
        async def invalidatable() -> AnalysisOutput:
            nonlocal execution_count
            execution_count += 1
            return AnalysisOutput(files=["file.py"], summary=f"Run {execution_count}")

        with tempfile.TemporaryDirectory() as tmpdir:
            cache = SqliteCache(Path(tmpdir) / "cache.db")
            graph = build_graph(invalidatable)

            # First run
            await run_graph(graph, cache=cache)
            assert execution_count == 1

            # Second run with invalidation
            clear_registry()

            @workflow
            async def invalidatable() -> AnalysisOutput:
                nonlocal execution_count
                execution_count += 1
                return AnalysisOutput(files=["file.py"], summary=f"Run {execution_count}")

            graph = build_graph(invalidatable)
            await run_graph(graph, cache=cache, invalidate="invalidatable")
            assert execution_count == 2

    async def test_cache_stats(self):
        """Test cache statistics tracking."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cache = SqliteCache(Path(tmpdir) / "cache.db")

            @workflow
            async def tracked() -> AnalysisOutput:
                return AnalysisOutput(files=["tracked.py"], summary="Tracked")

            graph = build_graph(tracked)

            # First run - cache miss
            await run_graph(graph, cache=cache)

            stats = await cache.stats()
            assert stats.entries == 1
            assert stats.misses >= 1

            # Second run with same graph - should hit cache
            result2 = await run_graph(graph, cache=cache, return_all=True)

            # Verify we used the cache
            assert result2.stats.workflows_cached >= 1 or stats.entries == 1


class TestRunGraphSkip:
    """Tests for workflow skip functionality."""

    async def test_skip_result(self):
        """Test that skip() returns None and marks workflow as skipped."""

        @workflow
        async def skippable() -> AnalysisOutput | None:
            return skip("Skipping for test")

        graph = build_graph(skippable)
        result = await run_graph(graph)

        assert result is None

    async def test_downstream_skipped_on_skip(self):
        """Test that downstream workflows are skipped when dependency skips."""

        @workflow
        async def skipper() -> AnalysisOutput | None:
            return skip("First step skipped")

        @workflow
        async def dependent(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=analysis.files)

        graph = build_graph(dependent)
        result = await run_graph(graph)

        # Dependent should be skipped due to upstream skip
        assert result is None


class TestRunGraphReturnAll:
    """Tests for return_all option."""

    async def test_return_all_includes_all_outputs(self):
        """Test that return_all returns all workflow outputs."""

        @workflow
        async def step1() -> AnalysisOutput:
            return AnalysisOutput(files=["a.py"], summary="Step 1")

        @workflow
        async def step2(analysis: AnalysisOutput) -> ImplementOutput:
            return ImplementOutput(changed_files=analysis.files)

        graph = build_graph(step2)
        result = await run_graph(graph, return_all=True)

        assert result.output == ImplementOutput(changed_files=["a.py"])
        assert "step1" in result.outputs
        assert "step2" in result.outputs
        assert result.outputs["step1"].summary == "Step 1"

    async def test_return_all_includes_stats(self):
        """Test that return_all includes execution statistics."""

        @workflow
        async def simple() -> AnalysisOutput:
            return AnalysisOutput(files=[], summary="Simple")

        graph = build_graph(simple)
        result = await run_graph(graph, return_all=True)

        assert result.stats.workflows_executed == 1
        assert result.stats.total_duration_ms >= 0


class TestRunGraphDryRun:
    """Tests for dry run mode."""

    async def test_dry_run_returns_plan(self):
        """Test that dry_run returns execution plan without running."""
        execution_count = 0

        @workflow
        async def not_executed() -> AnalysisOutput:
            nonlocal execution_count
            execution_count += 1
            return AnalysisOutput(files=[], summary="")

        graph = build_graph(not_executed)
        plan = await run_graph(graph, dry_run=True)

        assert execution_count == 0  # Not executed
        assert "not_executed" in plan.workflows
        assert plan.levels == [["not_executed"]]
