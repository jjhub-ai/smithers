"""Tests for Claude LLM integration and FakeLLMProvider."""

import pytest
from pydantic import BaseModel

from smithers.claude import claude
from smithers.testing.fakes import FakeLLMProvider, use_fake_llm


class AnalysisOutput(BaseModel):
    files: list[str]
    summary: str


class ImplementOutput(BaseModel):
    changed_files: list[str]
    success: bool


class TestFakeLLMProviderIntegration:
    """Tests for FakeLLMProvider integration with claude()."""

    async def test_fake_provider_returns_response(self):
        """Test that fake provider intercepts claude() calls."""
        fake = FakeLLMProvider(responses=[{"files": ["a.py", "b.py"], "summary": "Found 2 files"}])

        with use_fake_llm(fake):
            result = await claude("Analyze the codebase", output=AnalysisOutput)

        assert result.files == ["a.py", "b.py"]
        assert result.summary == "Found 2 files"

    async def test_fake_provider_records_calls(self):
        """Test that fake provider records all calls."""
        fake = FakeLLMProvider(responses=[{"files": ["x.py"], "summary": "test"}])

        with use_fake_llm(fake):
            await claude(
                "Analyze code",
                output=AnalysisOutput,
                tools=["Read", "Grep"],
                system="Be concise",
            )

        assert len(fake.calls) == 1
        call = fake.calls[0]
        assert call.prompt == "Analyze code"
        assert call.output_type == AnalysisOutput
        assert call.tools == ["Read", "Grep"]
        assert call.system == "Be concise"

    async def test_fake_provider_multiple_responses(self):
        """Test that fake provider returns responses in order."""
        fake = FakeLLMProvider(
            responses=[
                {"files": ["first.py"], "summary": "First call"},
                {"files": ["second.py"], "summary": "Second call"},
            ]
        )

        with use_fake_llm(fake):
            result1 = await claude("First", output=AnalysisOutput)
            result2 = await claude("Second", output=AnalysisOutput)

        assert result1.files == ["first.py"]
        assert result2.files == ["second.py"]
        assert len(fake.calls) == 2

    async def test_fake_provider_exhausted_raises(self):
        """Test that exhausted fake provider raises error."""
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "one"}])

        with use_fake_llm(fake):
            await claude("First", output=AnalysisOutput)

            with pytest.raises(RuntimeError, match="exhausted"):
                await claude("Second", output=AnalysisOutput)

    async def test_fake_provider_validates_response(self):
        """Test that fake provider validates response against output type."""
        fake = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "test"}])

        with use_fake_llm(fake):
            result = await claude("Test", output=AnalysisOutput)

        assert isinstance(result, AnalysisOutput)

    async def test_fake_provider_with_pydantic_model_response(self):
        """Test that fake provider accepts Pydantic model responses."""
        fake = FakeLLMProvider(responses=[AnalysisOutput(files=["model.py"], summary="From model")])

        with use_fake_llm(fake):
            result = await claude("Test", output=AnalysisOutput)

        assert result.files == ["model.py"]
        assert result.summary == "From model"

    async def test_fake_provider_reset(self):
        """Test that fake provider can be reset for reuse."""
        fake = FakeLLMProvider(responses=[{"files": ["a.py"], "summary": "test"}])

        with use_fake_llm(fake):
            await claude("First run", output=AnalysisOutput)

        fake.reset()
        assert fake._index == 0
        assert len(fake.calls) == 0

        with use_fake_llm(fake):
            result = await claude("Second run", output=AnalysisOutput)

        assert result.files == ["a.py"]

    async def test_fake_provider_add_response(self):
        """Test adding responses dynamically."""
        fake = FakeLLMProvider()
        fake.add_response({"files": ["dynamic.py"], "summary": "Added"})

        with use_fake_llm(fake):
            result = await claude("Test", output=AnalysisOutput)

        assert result.files == ["dynamic.py"]

    async def test_context_manager_cleanup(self):
        """Test that context manager properly cleans up fake provider."""
        fake = FakeLLMProvider(responses=[{"files": [], "summary": "fake"}])

        # Before context - no fake provider active
        from smithers.testing.fakes import get_fake_llm_provider

        assert get_fake_llm_provider() is None

        with use_fake_llm(fake):
            # Inside context - fake provider active
            assert get_fake_llm_provider() is fake

        # After context - no fake provider active
        assert get_fake_llm_provider() is None

    async def test_nested_fake_providers(self):
        """Test that nested fake providers work correctly."""
        outer_fake = FakeLLMProvider(responses=[{"files": ["outer.py"], "summary": "outer"}])
        inner_fake = FakeLLMProvider(responses=[{"files": ["inner.py"], "summary": "inner"}])

        with use_fake_llm(outer_fake):
            result1 = await claude("Outer call", output=AnalysisOutput)

            with use_fake_llm(inner_fake):
                result2 = await claude("Inner call", output=AnalysisOutput)

            # After inner context, outer should be restored
            # Note: we exhausted outer_fake, so this would fail if we tried another call

        assert result1.files == ["outer.py"]
        assert result2.files == ["inner.py"]


class TestFakeProviderTypeValidation:
    """Tests for type validation in FakeLLMProvider."""

    async def test_invalid_response_structure_raises(self):
        """Test that invalid response structure raises validation error."""
        fake = FakeLLMProvider(
            responses=[{"wrong_field": "value"}]  # Missing required fields
        )

        from pydantic import ValidationError

        with use_fake_llm(fake), pytest.raises(ValidationError):
            await claude("Test", output=AnalysisOutput)

    async def test_different_output_types(self):
        """Test fake provider with different output types."""
        fake = FakeLLMProvider(
            responses=[
                {"files": ["a.py"], "summary": "analysis"},
                {"changed_files": ["a.py"], "success": True},
            ]
        )

        with use_fake_llm(fake):
            analysis = await claude("Analyze", output=AnalysisOutput)
            impl = await claude("Implement", output=ImplementOutput)

        assert isinstance(analysis, AnalysisOutput)
        assert isinstance(impl, ImplementOutput)
        assert impl.success is True
