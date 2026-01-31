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


class TestFakeToolResult:
    """Tests for FakeToolResult dataclass."""

    def test_creation(self):
        """Test creating a FakeToolResult."""
        from smithers.testing.fakes import FakeToolResult

        result = FakeToolResult(
            tool_name="Read",
            input_args={"path": "/test.py"},
            output={"content": "hello"},
        )
        assert result.tool_name == "Read"
        assert result.input_args == {"path": "/test.py"}
        assert result.output == {"content": "hello"}

    def test_creation_with_various_outputs(self):
        """Test creating FakeToolResult with different output types."""
        from smithers.testing.fakes import FakeToolResult

        # String output
        result1 = FakeToolResult(tool_name="Bash", input_args={}, output="stdout data")
        assert result1.output == "stdout data"

        # List output
        result2 = FakeToolResult(tool_name="Grep", input_args={}, output=["file1.py", "file2.py"])
        assert result2.output == ["file1.py", "file2.py"]

        # None output
        result3 = FakeToolResult(tool_name="Delete", input_args={}, output=None)
        assert result3.output is None


class TestFakeToolProvider:
    """Tests for FakeToolProvider."""

    def test_creation_with_empty_responses(self):
        """Test creating a FakeToolProvider with no responses."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider()
        assert provider.responses == {}
        assert provider.calls == []

    def test_creation_with_responses(self):
        """Test creating a FakeToolProvider with initial responses."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(
            responses={
                "Read": {"content": "file content"},
                "Bash": {"exit_code": 0, "stdout": "output"},
            }
        )
        assert "Read" in provider.responses
        assert "Bash" in provider.responses

    def test_set_response(self):
        """Test setting a response for a tool."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider()
        provider.set_response("Read", {"content": "test content"})
        assert provider.responses["Read"] == {"content": "test content"}

    def test_set_response_overwrites(self):
        """Test that set_response overwrites existing response."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(responses={"Read": {"content": "old"}})
        provider.set_response("Read", {"content": "new"})
        assert provider.responses["Read"] == {"content": "new"}

    @pytest.mark.asyncio
    async def test_invoke_returns_response(self):
        """Test that invoke returns the configured response."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(
            responses={
                "Read": {"path": "test.py", "content": "hello world"},
            }
        )

        result = await provider.invoke("Read", {"path": "test.py"})
        assert result == {"path": "test.py", "content": "hello world"}

    @pytest.mark.asyncio
    async def test_invoke_records_call(self):
        """Test that invoke records the call."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(
            responses={
                "Bash": {"exit_code": 0, "stdout": "success"},
            }
        )

        await provider.invoke("Bash", {"command": "echo hello"})

        assert len(provider.calls) == 1
        assert provider.calls[0].tool_name == "Bash"
        assert provider.calls[0].input_args == {"command": "echo hello"}
        assert provider.calls[0].output == {"exit_code": 0, "stdout": "success"}

    @pytest.mark.asyncio
    async def test_invoke_records_multiple_calls(self):
        """Test that invoke records multiple calls in order."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(
            responses={
                "Read": "content1",
                "Grep": ["match1", "match2"],
            }
        )

        await provider.invoke("Read", {"path": "a.py"})
        await provider.invoke("Grep", {"pattern": "test"})
        await provider.invoke("Read", {"path": "b.py"})

        assert len(provider.calls) == 3
        assert provider.calls[0].tool_name == "Read"
        assert provider.calls[1].tool_name == "Grep"
        assert provider.calls[2].tool_name == "Read"

    @pytest.mark.asyncio
    async def test_invoke_raises_for_unconfigured_tool(self):
        """Test that invoke raises when tool is not configured."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(responses={"Read": "content"})

        with pytest.raises(RuntimeError, match="No fake response configured for tool: Write"):
            await provider.invoke("Write", {"content": "data"})

    @pytest.mark.asyncio
    async def test_invoke_with_callable_response(self):
        """Test that invoke supports callable responses for dynamic behavior."""
        from typing import Any

        from smithers.testing.fakes import FakeToolProvider

        def dynamic_read(args: dict[str, Any]) -> dict[str, str]:
            return {"content": f"Content of {args['path']}"}

        provider = FakeToolProvider(responses={"Read": dynamic_read})

        result1 = await provider.invoke("Read", {"path": "file1.py"})
        result2 = await provider.invoke("Read", {"path": "file2.py"})

        assert result1 == {"content": "Content of file1.py"}
        assert result2 == {"content": "Content of file2.py"}

    @pytest.mark.asyncio
    async def test_invoke_callable_records_correct_output(self):
        """Test that callable responses record the actual output."""
        from typing import Any

        from smithers.testing.fakes import FakeToolProvider

        def dynamic_response(args: dict[str, Any]) -> int:
            return args["value"] * 2

        provider = FakeToolProvider(responses={"Compute": dynamic_response})

        await provider.invoke("Compute", {"value": 5})

        assert len(provider.calls) == 1
        assert provider.calls[0].output == 10

    @pytest.mark.asyncio
    async def test_invoke_with_none_response(self):
        """Test that invoke can return None."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(responses={"Delete": None})

        result = await provider.invoke("Delete", {"path": "temp.txt"})
        assert result is None

    @pytest.mark.asyncio
    async def test_invoke_with_string_response(self):
        """Test that invoke works with string responses."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(responses={"Read": "file contents here"})

        result = await provider.invoke("Read", {"path": "test.txt"})
        assert result == "file contents here"

    @pytest.mark.asyncio
    async def test_invoke_with_list_response(self):
        """Test that invoke works with list responses."""
        from smithers.testing.fakes import FakeToolProvider

        provider = FakeToolProvider(responses={"Glob": ["a.py", "b.py", "c.py"]})

        result = await provider.invoke("Glob", {"pattern": "*.py"})
        assert result == ["a.py", "b.py", "c.py"]


class TestUseFakeLLMAsync:
    """Tests for the use_fake_llm_async async context manager."""

    @pytest.mark.asyncio
    async def test_basic_usage(self):
        """Test basic async context manager usage."""
        from smithers.testing.fakes import use_fake_llm_async

        fake = FakeLLMProvider(responses=[{"files": ["test.py"], "summary": "Test"}])

        async with use_fake_llm_async(fake):
            result = await claude("Analyze", output=AnalysisOutput)

        assert result.files == ["test.py"]
        assert result.summary == "Test"

    @pytest.mark.asyncio
    async def test_records_calls(self):
        """Test that calls are recorded in async context."""
        from smithers.testing.fakes import use_fake_llm_async

        fake = FakeLLMProvider(responses=[{"files": [], "summary": ""}])

        async with use_fake_llm_async(fake):
            await claude("My prompt", output=AnalysisOutput, tools=["Read"])

        assert len(fake.calls) == 1
        assert fake.calls[0].prompt == "My prompt"
        assert fake.calls[0].tools == ["Read"]

    @pytest.mark.asyncio
    async def test_cleanup_on_exception(self):
        """Test that async context manager cleans up on exception."""
        from smithers.testing.fakes import get_fake_llm_provider, use_fake_llm_async

        fake = FakeLLMProvider(responses=[{"files": [], "summary": ""}])

        with pytest.raises(ValueError):
            async with use_fake_llm_async(fake):
                await claude("Test", output=AnalysisOutput)
                raise ValueError("Intentional")

        # Provider should be cleaned up
        assert get_fake_llm_provider() is None

    @pytest.mark.asyncio
    async def test_yields_provider(self):
        """Test that async context manager yields the provider."""
        from smithers.testing.fakes import use_fake_llm_async

        fake = FakeLLMProvider(responses=[{"files": [], "summary": ""}])

        async with use_fake_llm_async(fake) as yielded:
            assert yielded is fake

    @pytest.mark.asyncio
    async def test_nested_async_contexts(self):
        """Test nested async context managers."""
        from smithers.testing.fakes import use_fake_llm_async

        outer = FakeLLMProvider(responses=[{"files": ["outer.py"], "summary": "Outer"}])
        inner = FakeLLMProvider(responses=[{"files": ["inner.py"], "summary": "Inner"}])

        async with use_fake_llm_async(outer):
            r1 = await claude("Outer", output=AnalysisOutput)

            async with use_fake_llm_async(inner):
                r2 = await claude("Inner", output=AnalysisOutput)

        assert r1.files == ["outer.py"]
        assert r2.files == ["inner.py"]


class TestUseRuntimeAsync:
    """Tests for the use_runtime_async async context manager."""

    @pytest.mark.asyncio
    async def test_basic_usage(self):
        """Test basic async context manager usage."""
        from smithers.testing.fakes import use_runtime_async

        fake = FakeLLMProvider(responses=[{"files": ["test.py"], "summary": "Test"}])

        async with use_runtime_async(llm=fake):
            result = await claude("Analyze", output=AnalysisOutput)

        assert result.files == ["test.py"]

    @pytest.mark.asyncio
    async def test_with_none_llm(self):
        """Test that use_runtime_async(llm=None) doesn't set a provider."""
        from smithers.testing.fakes import get_fake_llm_provider, use_runtime_async

        async with use_runtime_async(llm=None):
            assert get_fake_llm_provider() is None

    @pytest.mark.asyncio
    async def test_cleanup_on_exception(self):
        """Test that async context manager cleans up on exception."""
        from smithers.testing.fakes import get_fake_llm_provider, use_runtime_async

        fake = FakeLLMProvider(responses=[{"files": [], "summary": ""}])

        with pytest.raises(ValueError):
            async with use_runtime_async(llm=fake):
                await claude("Test", output=AnalysisOutput)
                raise ValueError("Intentional")

        assert get_fake_llm_provider() is None
