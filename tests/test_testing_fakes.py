"""Tests for FakeLLMProvider and testing utilities."""

import pytest
from pydantic import BaseModel

from smithers.claude import claude
from smithers.graph import build_graph, run_graph
from smithers.testing import FakeLLMProvider, use_fake_llm
from smithers.workflow import workflow


class AnalysisOutput(BaseModel):
    files: list[str]
    summary: str


class ImplementOutput(BaseModel):
    changed_files: list[str]
    success: bool


class TestFakeLLMProvider:
    """Tests for the FakeLLMProvider class."""

    def test_returns_configured_responses(self):
        fake = FakeLLMProvider(
            responses=[
                {"files": ["a.py", "b.py"], "summary": "Test summary"},
            ]
        )

        result = fake.next_response(
            prompt="Analyze the code",
            output_type=AnalysisOutput,
            tools=None,
            system=None,
        )

        assert result.files == ["a.py", "b.py"]
        assert result.summary == "Test summary"

    def test_records_calls(self):
        fake = FakeLLMProvider(
            responses=[
                {"files": ["test.py"], "summary": "Summary"},
            ]
        )

        fake.next_response(
            prompt="Test prompt",
            output_type=AnalysisOutput,
            tools=["Read", "Edit"],
            system="System prompt",
        )

        assert len(fake.calls) == 1
        assert fake.calls[0].prompt == "Test prompt"
        assert fake.calls[0].tools == ["Read", "Edit"]
        assert fake.calls[0].system == "System prompt"
        assert fake.calls[0].output_type == AnalysisOutput

    def test_returns_multiple_responses_in_order(self):
        fake = FakeLLMProvider(
            responses=[
                {"files": ["first.py"], "summary": "First"},
                {"files": ["second.py"], "summary": "Second"},
            ]
        )

        first = fake.next_response("p1", AnalysisOutput, None, None)
        second = fake.next_response("p2", AnalysisOutput, None, None)

        assert first.files == ["first.py"]
        assert second.files == ["second.py"]

    def test_raises_when_exhausted(self):
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "Only one"}])

        fake.next_response("p1", AnalysisOutput, None, None)

        with pytest.raises(RuntimeError, match="exhausted"):
            fake.next_response("p2", AnalysisOutput, None, None)

    def test_reset_allows_reuse(self):
        fake = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "Test"}])

        fake.next_response("p1", AnalysisOutput, None, None)
        assert len(fake.calls) == 1

        fake.reset()

        result = fake.next_response("p2", AnalysisOutput, None, None)
        assert result.files == ["a.py"]
        assert len(fake.calls) == 1

    def test_validates_response_against_output_type(self):
        fake = FakeLLMProvider(
            responses=[
                {"files": "not_a_list", "summary": "Invalid"},  # files should be list
            ]
        )

        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            fake.next_response("prompt", AnalysisOutput, None, None)

    def test_accepts_pydantic_model_as_response(self):
        response = AnalysisOutput(files=["model.py"], summary="From model")
        fake = FakeLLMProvider(responses=[response])

        result = fake.next_response("prompt", AnalysisOutput, None, None)

        assert result.files == ["model.py"]
        assert result.summary == "From model"

    def test_add_response_method(self):
        fake = FakeLLMProvider()
        fake.add_response({"files": ["added.py"], "summary": "Added"})

        result = fake.next_response("prompt", AnalysisOutput, None, None)

        assert result.files == ["added.py"]


class TestUseFakeLLM:
    """Tests for the use_fake_llm context manager."""

    async def test_claude_uses_fake_provider(self):
        fake = FakeLLMProvider(responses=[{"files": ["fake.py"], "summary": "Fake response"}])

        with use_fake_llm(fake):
            result = await claude(
                "Analyze the code",
                output=AnalysisOutput,
            )

        assert result.files == ["fake.py"]
        assert result.summary == "Fake response"

    async def test_claude_records_call_details(self):
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "Test"}])

        with use_fake_llm(fake):
            await claude(
                "Detailed prompt",
                output=AnalysisOutput,
                tools=["Read"],
                system="Be helpful",
            )

        assert len(fake.calls) == 1
        assert fake.calls[0].prompt == "Detailed prompt"
        assert fake.calls[0].tools == ["Read"]
        assert fake.calls[0].system == "Be helpful"

    async def test_context_manager_restores_state(self):
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "In context"}])

        with use_fake_llm(fake):
            await claude("prompt", output=AnalysisOutput)

        # After exiting context, should use real provider (which requires API key)
        # We can't easily test this without mocking, so just verify the provider was unset
        from smithers.testing.fakes import get_fake_llm_provider

        assert get_fake_llm_provider() is None


class TestWorkflowsWithFakeLLM:
    """Tests for workflows using the fake LLM provider."""

    async def test_single_workflow_with_fake(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude(
                "Analyze the codebase",
                output=AnalysisOutput,
            )

        fake = FakeLLMProvider(
            responses=[{"files": ["main.py", "utils.py"], "summary": "Core modules"}]
        )

        with use_fake_llm(fake):
            result = await analyze()

        assert result.files == ["main.py", "utils.py"]
        assert result.summary == "Core modules"

    async def test_workflow_chain_with_fake(self):
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude(
                "Analyze the codebase",
                output=AnalysisOutput,
            )

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return await claude(
                f"Implement fixes for: {', '.join(analysis.files)}",
                output=ImplementOutput,
            )

        fake = FakeLLMProvider(
            responses=[
                {"files": ["api.py"], "summary": "API changes needed"},
                {"changed_files": ["api.py"], "success": True},
            ]
        )

        with use_fake_llm(fake):
            graph = build_graph(implement)
            result = await run_graph(graph)

        assert result.changed_files == ["api.py"]
        assert result.success is True

        # Verify both workflows were called
        assert len(fake.calls) == 2
        assert "Analyze" in fake.calls[0].prompt
        assert "api.py" in fake.calls[1].prompt

    async def test_parallel_workflows_with_fake(self):
        class LintOutput(BaseModel):
            issues: list[str]

        class TestOutput(BaseModel):
            passed: bool

        class MergeOutput(BaseModel):
            status: str

        @workflow
        async def base() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        @workflow
        async def lint(analysis: AnalysisOutput) -> LintOutput:
            return await claude(f"Lint {analysis.files}", output=LintOutput)

        @workflow
        async def test(analysis: AnalysisOutput) -> TestOutput:
            return await claude(f"Test {analysis.files}", output=TestOutput)

        @workflow
        async def merge(lint_result: LintOutput, test_result: TestOutput) -> MergeOutput:
            return await claude("Merge results", output=MergeOutput)

        fake = FakeLLMProvider(
            responses=[
                {"files": ["app.py"], "summary": "App code"},
                {"issues": []},
                {"passed": True},
                {"status": "merged"},
            ]
        )

        with use_fake_llm(fake):
            graph = build_graph(merge)
            result = await run_graph(graph)

        assert result.status == "merged"
        assert len(fake.calls) == 4

    async def test_workflow_with_tools_parameter(self):
        @workflow
        async def code_review() -> AnalysisOutput:
            return await claude(
                "Review the code",
                output=AnalysisOutput,
                tools=["Read", "Grep"],
            )

        fake = FakeLLMProvider(responses=[{"files": ["reviewed.py"], "summary": "Code looks good"}])

        with use_fake_llm(fake):
            await code_review()

        assert fake.calls[0].tools == ["Read", "Grep"]


class TestFakeLLMProviderEdgeCases:
    """Edge case tests for FakeLLMProvider."""

    def test_different_output_types_in_sequence(self):
        fake = FakeLLMProvider(
            responses=[
                {"files": ["a.py"], "summary": "Analysis"},
                {"changed_files": ["a.py"], "success": True},
            ]
        )

        first = fake.next_response("p1", AnalysisOutput, None, None)
        second = fake.next_response("p2", ImplementOutput, None, None)

        assert isinstance(first, AnalysisOutput)
        assert isinstance(second, ImplementOutput)

    def test_empty_responses_list(self):
        fake = FakeLLMProvider(responses=[])

        with pytest.raises(RuntimeError, match="exhausted"):
            fake.next_response("prompt", AnalysisOutput, None, None)

    async def test_nested_use_fake_llm_contexts(self):
        fake1 = FakeLLMProvider(responses=[{"files": ["outer.py"], "summary": "Outer"}])
        fake2 = FakeLLMProvider(responses=[{"files": ["inner.py"], "summary": "Inner"}])

        with use_fake_llm(fake1):
            outer_result = await claude("Outer prompt", output=AnalysisOutput)

            with use_fake_llm(fake2):
                inner_result = await claude("Inner prompt", output=AnalysisOutput)

            # After inner context, should be back to fake1
            # But fake1 is exhausted now, so this would fail
            # This tests that contexts properly nest

        assert outer_result.files == ["outer.py"]
        assert inner_result.files == ["inner.py"]
