"""Tests for the testing utilities."""

import pytest
from pydantic import BaseModel

from smithers import claude
from smithers.testing import FakeLLMProvider, use_fake_llm


class SimpleOutput(BaseModel):
    message: str


class ComplexOutput(BaseModel):
    items: list[str]
    count: int
    metadata: dict[str, str]


class TestFakeLLMProvider:
    """Tests for FakeLLMProvider."""

    async def test_returns_configured_response(self):
        fake = FakeLLMProvider(responses=[{"message": "Hello"}])

        with use_fake_llm(fake):
            result = await claude("Say hello", output=SimpleOutput)

        assert result.message == "Hello"

    async def test_returns_multiple_responses_in_order(self):
        fake = FakeLLMProvider(
            responses=[
                {"message": "First"},
                {"message": "Second"},
                {"message": "Third"},
            ]
        )

        with use_fake_llm(fake):
            r1 = await claude("Prompt 1", output=SimpleOutput)
            r2 = await claude("Prompt 2", output=SimpleOutput)
            r3 = await claude("Prompt 3", output=SimpleOutput)

        assert r1.message == "First"
        assert r2.message == "Second"
        assert r3.message == "Third"

    async def test_records_calls(self):
        fake = FakeLLMProvider(responses=[{"message": "Response"}])

        with use_fake_llm(fake):
            await claude(
                "Test prompt",
                output=SimpleOutput,
                tools=["Read", "Edit"],
                system="Be helpful",
            )

        assert len(fake.calls) == 1
        call = fake.calls[0]
        assert call.prompt == "Test prompt"
        assert call.output_type == SimpleOutput
        assert call.tools == ["Read", "Edit"]
        assert call.system == "Be helpful"

    async def test_raises_when_exhausted(self):
        fake = FakeLLMProvider(responses=[{"message": "Only one"}])

        with use_fake_llm(fake):
            await claude("First", output=SimpleOutput)

            with pytest.raises(RuntimeError, match="exhausted"):
                await claude("Second", output=SimpleOutput)

    async def test_validates_response_against_output_type(self):
        fake = FakeLLMProvider(
            responses=[{"message": "Valid"}]  # Valid for SimpleOutput
        )

        with use_fake_llm(fake):
            result = await claude("Test", output=SimpleOutput)
            assert isinstance(result, SimpleOutput)

    async def test_complex_response_validation(self):
        fake = FakeLLMProvider(
            responses=[
                {
                    "items": ["a", "b", "c"],
                    "count": 3,
                    "metadata": {"source": "test"},
                }
            ]
        )

        with use_fake_llm(fake):
            result = await claude("Get items", output=ComplexOutput)

        assert result.items == ["a", "b", "c"]
        assert result.count == 3
        assert result.metadata == {"source": "test"}

    async def test_accepts_pydantic_model_as_response(self):
        response_model = SimpleOutput(message="From model")
        fake = FakeLLMProvider(responses=[response_model])

        with use_fake_llm(fake):
            result = await claude("Test", output=SimpleOutput)

        assert result.message == "From model"

    async def test_reset_clears_calls_and_index(self):
        fake = FakeLLMProvider(responses=[{"message": "Test"}])

        with use_fake_llm(fake):
            await claude("First call", output=SimpleOutput)

        assert len(fake.calls) == 1

        fake.reset()

        assert len(fake.calls) == 0

        # Should be able to get the same response again
        with use_fake_llm(fake):
            result = await claude("Second call", output=SimpleOutput)

        assert result.message == "Test"

    async def test_add_response_dynamically(self):
        fake = FakeLLMProvider(responses=[])
        fake.add_response({"message": "Added"})

        with use_fake_llm(fake):
            result = await claude("Test", output=SimpleOutput)

        assert result.message == "Added"


class TestUseFakeLLMContextManager:
    """Tests for the use_fake_llm context manager."""

    async def test_context_manager_scoping(self):
        fake1 = FakeLLMProvider(responses=[{"message": "Fake1"}])
        fake2 = FakeLLMProvider(responses=[{"message": "Fake2"}])

        with use_fake_llm(fake1):
            r1 = await claude("Test", output=SimpleOutput)

            with use_fake_llm(fake2):
                r2 = await claude("Test", output=SimpleOutput)

            # Back to fake1 scope - but it's exhausted
            # This should use fake1 again

        assert r1.message == "Fake1"
        assert r2.message == "Fake2"

    async def test_context_manager_cleanup_on_exception(self):
        fake = FakeLLMProvider(responses=[{"message": "Test"}])

        with pytest.raises(ValueError), use_fake_llm(fake):
            await claude("Test", output=SimpleOutput)
            raise ValueError("Intentional error")

        # Fake provider should be cleaned up
        # Next call without context should fail
        from smithers.testing.fakes import get_fake_llm_provider

        assert get_fake_llm_provider() is None


class TestUseRuntime:
    """Tests for the use_runtime context manager (ARCHITECTURE.md API)."""

    async def test_use_runtime_with_llm(self):
        """Test use_runtime matches the ARCHITECTURE.md example."""
        from smithers.testing import use_runtime

        class AnalysisOutput(BaseModel):
            files: list[str]
            summary: str

        fake = FakeLLMProvider(responses=[{"files": ["x.py"], "summary": "ok"}])
        with use_runtime(llm=fake):
            result = await claude("Analyze", output=AnalysisOutput)
            assert result.files == ["x.py"]
            assert result.summary == "ok"

    async def test_use_runtime_records_calls(self):
        """Test that use_runtime properly records calls."""
        from smithers.testing import use_runtime

        fake = FakeLLMProvider(responses=[{"message": "Test"}])
        with use_runtime(llm=fake):
            await claude("My prompt", output=SimpleOutput, tools=["Read"])

        assert len(fake.calls) == 1
        assert fake.calls[0].prompt == "My prompt"
        assert fake.calls[0].tools == ["Read"]

    async def test_use_runtime_with_none_does_not_inject(self):
        """Test that use_runtime(llm=None) doesn't set a provider."""
        from smithers.testing import use_runtime
        from smithers.testing.fakes import get_fake_llm_provider

        # Start with no provider
        assert get_fake_llm_provider() is None

        with use_runtime(llm=None):
            # Should still be None
            assert get_fake_llm_provider() is None

    async def test_use_runtime_nested(self):
        """Test nested use_runtime contexts."""
        from smithers.testing import use_runtime

        outer = FakeLLMProvider(responses=[{"message": "Outer"}])
        inner = FakeLLMProvider(responses=[{"message": "Inner"}])

        with use_runtime(llm=outer):
            r1 = await claude("Test", output=SimpleOutput)

            with use_runtime(llm=inner):
                r2 = await claude("Test", output=SimpleOutput)

            # Note: outer is exhausted here

        assert r1.message == "Outer"
        assert r2.message == "Inner"


class TestResponsesByType:
    """Tests for responses_by_type feature (for parallel execution)."""

    async def test_responses_by_type_basic(self):
        """Test that responses_by_type works for parallel execution."""

        class OutputA(BaseModel):
            a: str

        class OutputB(BaseModel):
            b: int

        fake = FakeLLMProvider(
            responses_by_type={
                OutputA: {"a": "value_a"},
                OutputB: {"b": 42},
            }
        )

        with use_fake_llm(fake):
            # Order doesn't matter - responses are by type
            result_b = await claude("Get B", output=OutputB)
            result_a = await claude("Get A", output=OutputA)

        assert result_a.a == "value_a"
        assert result_b.b == 42

    async def test_responses_by_type_mixed_with_sequential(self):
        """Test that type-based responses take precedence."""

        class OutputA(BaseModel):
            a: str

        fake = FakeLLMProvider(
            responses=[{"a": "sequential"}],  # Fallback
            responses_by_type={
                OutputA: {"a": "by_type"},  # Takes precedence
            },
        )

        with use_fake_llm(fake):
            result = await claude("Test", output=OutputA)

        assert result.a == "by_type"

    async def test_set_response_for_type(self):
        """Test dynamically setting type-based responses."""

        class OutputA(BaseModel):
            a: str

        fake = FakeLLMProvider()
        fake.set_response_for_type(OutputA, {"a": "dynamic"})

        with use_fake_llm(fake):
            result = await claude("Test", output=OutputA)

        assert result.a == "dynamic"
