"""Tests for the FakeLLMProvider and claude() integration."""

import pytest
from pydantic import BaseModel

from smithers.claude import claude
from smithers.testing import FakeLLMProvider, use_fake_llm
from smithers.workflow import workflow


class AnalysisOutput(BaseModel):
    files: list[str]
    summary: str


class ImplementOutput(BaseModel):
    changed_files: list[str]
    success: bool


class TestFakeLLMProvider:
    """Tests for FakeLLMProvider class."""

    def test_creates_provider_with_responses(self) -> None:
        fake = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "Test analysis"}])
        assert len(fake.responses) == 1
        assert len(fake.calls) == 0

    def test_add_response(self) -> None:
        fake = FakeLLMProvider()
        fake.add_response({"files": ["b.py"], "summary": "Added"})
        assert len(fake.responses) == 1

    def test_next_response_validates_output(self) -> None:
        fake = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "Valid"}])
        result = fake.next_response(
            prompt="test prompt",
            output_type=AnalysisOutput,
            tools=None,
            system=None,
        )
        assert isinstance(result, AnalysisOutput)
        assert result.files == ["a.py"]
        assert result.summary == "Valid"

    def test_next_response_records_call(self) -> None:
        fake = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "Test"}])
        fake.next_response(
            prompt="analyze the code",
            output_type=AnalysisOutput,
            tools=["Read", "Grep"],
            system="You are an analyst",
        )
        assert len(fake.calls) == 1
        call = fake.calls[0]
        assert call.prompt == "analyze the code"
        assert call.output_type == AnalysisOutput
        assert call.tools == ["Read", "Grep"]
        assert call.system == "You are an analyst"

    def test_next_response_exhausted_raises(self) -> None:
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "One"}])
        fake.next_response("first", AnalysisOutput, None, None)

        with pytest.raises(RuntimeError, match="exhausted"):
            fake.next_response("second", AnalysisOutput, None, None)

    def test_next_response_accepts_pydantic_model(self) -> None:
        response_model = AnalysisOutput(files=["x.py"], summary="From model")
        fake = FakeLLMProvider(responses=[response_model])
        result = fake.next_response("test", AnalysisOutput, None, None)
        assert result.files == ["x.py"]
        assert result.summary == "From model"

    def test_reset_clears_state(self) -> None:
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "Test"}])
        fake.next_response("test", AnalysisOutput, None, None)
        assert len(fake.calls) == 1
        assert fake._index == 1

        fake.reset()
        assert len(fake.calls) == 0
        assert fake._index == 0


class TestUseFakeLLM:
    """Tests for use_fake_llm context manager."""

    async def test_claude_uses_fake_provider(self) -> None:
        fake = FakeLLMProvider(responses=[{"files": ["test.py"], "summary": "Mocked response"}])

        with use_fake_llm(fake):
            result = await claude(
                "Analyze the code",
                output=AnalysisOutput,
                tools=["Read"],
            )

        assert isinstance(result, AnalysisOutput)
        assert result.files == ["test.py"]
        assert result.summary == "Mocked response"
        assert len(fake.calls) == 1

    async def test_multiple_claude_calls(self) -> None:
        fake = FakeLLMProvider(
            responses=[
                {"files": ["a.py"], "summary": "First"},
                {"changed_files": ["a.py"], "success": True},
            ]
        )

        with use_fake_llm(fake):
            result1 = await claude("First call", output=AnalysisOutput)
            result2 = await claude("Second call", output=ImplementOutput)

        assert result1.files == ["a.py"]
        assert result2.changed_files == ["a.py"]
        assert len(fake.calls) == 2

    async def test_fake_provider_not_active_outside_context(self) -> None:
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "Test"}])

        with use_fake_llm(fake):
            pass  # Provider is active here

        # Outside context, provider should not be active
        # This would require ANTHROPIC_API_KEY to be set, so we skip actual call
        from smithers.testing.fakes import get_fake_llm_provider

        assert get_fake_llm_provider() is None


class TestWorkflowWithFakeLLM:
    """Tests for using FakeLLMProvider with workflows."""

    async def test_workflow_with_fake_llm(self) -> None:
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude(
                "Analyze the codebase",
                output=AnalysisOutput,
                tools=["Read", "Grep"],
            )

        fake = FakeLLMProvider(
            responses=[{"files": ["main.py", "utils.py"], "summary": "Two files found"}]
        )

        with use_fake_llm(fake):
            result = await analyze()

        assert result.files == ["main.py", "utils.py"]
        assert result.summary == "Two files found"
        assert len(fake.calls) == 1
        assert fake.calls[0].tools == ["Read", "Grep"]

    async def test_dependent_workflows_with_fake_llm(self) -> None:
        @workflow
        async def analyze() -> AnalysisOutput:
            return await claude("Analyze", output=AnalysisOutput)

        @workflow
        async def implement(analysis: AnalysisOutput) -> ImplementOutput:
            return await claude(
                f"Implement fixes for {analysis.files}",
                output=ImplementOutput,
            )

        fake = FakeLLMProvider(
            responses=[
                {"files": ["api.py"], "summary": "Found issue in API"},
                {"changed_files": ["api.py"], "success": True},
            ]
        )

        with use_fake_llm(fake):
            analysis = await analyze()
            impl = await implement(analysis)

        assert analysis.files == ["api.py"]
        assert impl.changed_files == ["api.py"]
        assert impl.success is True
        assert len(fake.calls) == 2

    async def test_workflow_with_system_prompt(self) -> None:
        @workflow
        async def review() -> AnalysisOutput:
            return await claude(
                "Review the code",
                output=AnalysisOutput,
                system="You are a senior code reviewer.",
            )

        fake = FakeLLMProvider(responses=[{"files": ["review.py"], "summary": "Code looks good"}])

        with use_fake_llm(fake):
            result = await review()

        assert fake.calls[0].system == "You are a senior code reviewer."
        assert result.summary == "Code looks good"
