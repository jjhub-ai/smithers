"""Tests for the tools system."""

from pathlib import Path

import pytest

from smithers.tools import (
    Bash,
    Edit,
    Glob,
    Grep,
    Read,
    Tool,
    get_all_tools,
    get_tool,
)


class TestBuiltinTools:
    """Tests for built-in tools."""

    async def test_read_tool(self, tmp_path: Path):
        # Create a test file
        test_file = tmp_path / "test.txt"
        test_file.write_text("Hello, World!")

        result = await Read(str(test_file))

        assert result["path"] == str(test_file)
        assert result["content"] == "Hello, World!"

    async def test_read_tool_file_not_found(self, tmp_path: Path):
        with pytest.raises(FileNotFoundError):
            await Read(str(tmp_path / "nonexistent.txt"))

    async def test_edit_tool(self, tmp_path: Path):
        test_file = tmp_path / "output.txt"

        result = await Edit(str(test_file), "New content")

        assert result["path"] == str(test_file)
        assert result["written"] == len("New content")
        assert test_file.read_text() == "New content"

    async def test_edit_tool_creates_parent_dirs(self, tmp_path: Path):
        nested_file = tmp_path / "a" / "b" / "c" / "file.txt"

        await Edit(str(nested_file), "Nested content")

        assert nested_file.exists()
        assert nested_file.read_text() == "Nested content"

    async def test_glob_tool(self, tmp_path: Path):
        # Create test files
        (tmp_path / "file1.py").write_text("print(1)")
        (tmp_path / "file2.py").write_text("print(2)")
        (tmp_path / "file3.txt").write_text("text")

        result = await Glob("*.py", str(tmp_path))

        assert len(result["matches"]) == 2
        assert any("file1.py" in m for m in result["matches"])
        assert any("file2.py" in m for m in result["matches"])

    async def test_grep_tool(self, tmp_path: Path):
        # Create test files
        (tmp_path / "file1.py").write_text("def hello():\n    pass")
        (tmp_path / "file2.py").write_text("def world():\n    pass")
        (tmp_path / "file3.txt").write_text("no functions here")

        result = await Grep("def ", str(tmp_path))

        assert len(result["matches"]) == 2

    async def test_grep_tool_regex(self, tmp_path: Path):
        (tmp_path / "test.py").write_text("TODO: fix this\nFIXME: also this")

        result = await Grep(r"TODO|FIXME", str(tmp_path))

        assert len(result["matches"]) == 2

    async def test_grep_tool_max_matches(self, tmp_path: Path):
        # Create file with many matches
        content = "\n".join([f"line {i} match" for i in range(100)])
        (tmp_path / "many.txt").write_text(content)

        result = await Grep("match", str(tmp_path), max_matches=5)

        assert len(result["matches"]) == 5

    async def test_bash_tool(self):
        result = await Bash("echo 'hello'")

        assert result["exit_code"] == 0
        assert "hello" in result["stdout"]

    async def test_bash_tool_with_cwd(self, tmp_path: Path):
        result = await Bash("pwd", cwd=str(tmp_path))

        assert result["exit_code"] == 0
        assert str(tmp_path) in result["stdout"]

    async def test_bash_tool_captures_stderr(self):
        result = await Bash("echo 'error' >&2")

        assert "error" in result["stderr"]


class TestToolRegistry:
    """Tests for tool registration and retrieval."""

    def test_get_builtin_tool(self):
        read_tool = get_tool("Read")

        assert read_tool is not None
        assert read_tool.name == "Read"

    def test_get_nonexistent_tool(self):
        tool = get_tool("NonexistentTool")

        assert tool is None

    def test_get_all_tools(self):
        all_tools = get_all_tools()

        assert "Read" in all_tools
        assert "Edit" in all_tools
        assert "Glob" in all_tools
        assert "Grep" in all_tools
        assert "Bash" in all_tools


class TestCustomTools:
    """Tests for custom tool registration."""

    async def test_register_custom_tool(self):
        @Tool
        async def custom_tool(message: str) -> dict:
            """A custom tool."""
            return {"echoed": message}

        tool = get_tool("custom_tool")
        assert tool is not None

        result = await tool.invoke({"message": "hello"})
        assert result == {"echoed": "hello"}

    async def test_custom_tool_with_name(self):
        @Tool(name="MyCustomTool")
        async def some_function(x: int) -> dict:
            """Custom named tool."""
            return {"doubled": x * 2}

        tool = get_tool("MyCustomTool")
        assert tool is not None
        assert tool.description == "Custom named tool."

    async def test_tool_schema_generation(self):
        @Tool
        async def typed_tool(name: str, count: int = 1) -> dict:
            """A tool with typed parameters."""
            return {"name": name, "count": count}

        tool = get_tool("typed_tool")
        schema = tool.schema()

        assert schema["name"] == "typed_tool"
        assert "input_schema" in schema
        assert "properties" in schema["input_schema"]
        assert "name" in schema["input_schema"]["properties"]
        assert "count" in schema["input_schema"]["properties"]

    async def test_sync_function_wrapped_as_async(self):
        @Tool
        def sync_tool(value: str) -> dict:
            """A sync tool that gets wrapped."""
            return {"value": value.upper()}

        tool = get_tool("sync_tool")
        result = await tool.invoke({"value": "hello"})

        assert result == {"value": "HELLO"}
