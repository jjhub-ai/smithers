"""
Tests for the skills system.

Covers:
- Skill registry (registration, lookup, factories)
- Base skill interface
- Builtin skills (summarize, plan)
"""

import pytest

from agentd.skills.base import Skill, SkillContext, SkillMode, SkillResult
from agentd.skills.builtin.plan import PlanSkill
from agentd.skills.builtin.summarize import SummarizeSkill
from agentd.skills.registry import SkillRegistry, get_skill_registry


class TestSkillRegistry:
    """Test the SkillRegistry class."""

    def test_register_skill(self) -> None:
        """Test registering a skill instance."""
        registry = SkillRegistry()
        skill = SummarizeSkill()

        registry.register(skill)

        retrieved = registry.get("summarize")
        assert retrieved is not None
        assert retrieved.skill_id == "summarize"
        assert isinstance(retrieved, SummarizeSkill)

    def test_register_factory(self) -> None:
        """Test registering a skill factory."""
        registry = SkillRegistry()

        registry.register_factory("plan", PlanSkill)

        # Factory should not be instantiated yet
        assert "plan" not in registry._skills

        # Getting skill should instantiate from factory
        skill = registry.get("plan")
        assert skill is not None
        assert isinstance(skill, PlanSkill)

        # Subsequent gets should return same instance
        skill2 = registry.get("plan")
        assert skill2 is skill

    def test_get_nonexistent_skill(self) -> None:
        """Test getting a skill that doesn't exist."""
        registry = SkillRegistry()

        skill = registry.get("nonexistent")
        assert skill is None

    def test_list_skills_empty(self) -> None:
        """Test listing skills when registry is empty."""
        registry = SkillRegistry()

        skills = registry.list_skills()
        assert skills == []

    def test_list_skills_with_instances(self) -> None:
        """Test listing skills with registered instances."""
        registry = SkillRegistry()
        skill1 = SummarizeSkill()
        skill2 = PlanSkill()

        registry.register(skill1)
        registry.register(skill2)

        skills = registry.list_skills()
        assert len(skills) == 2
        assert skill1 in skills
        assert skill2 in skills

    def test_list_skills_with_factories(self) -> None:
        """Test listing skills with factories instantiates them."""
        registry = SkillRegistry()

        registry.register_factory("summarize", SummarizeSkill)
        registry.register_factory("plan", PlanSkill)

        # Before listing, skills should not be instantiated
        assert len(registry._skills) == 0

        # Listing should instantiate all factories
        skills = registry.list_skills()
        assert len(skills) == 2

        # All skills should now be instantiated
        assert len(registry._skills) == 2

        skill_ids = {s.skill_id for s in skills}
        assert skill_ids == {"summarize", "plan"}

    def test_list_skills_mixed(self) -> None:
        """Test listing with both instances and factories."""
        registry = SkillRegistry()
        skill1 = SummarizeSkill()

        registry.register(skill1)
        registry.register_factory("plan", PlanSkill)

        skills = registry.list_skills()
        assert len(skills) == 2

    def test_clear(self) -> None:
        """Test clearing the registry."""
        registry = SkillRegistry()
        skill = SummarizeSkill()

        registry.register(skill)
        registry.register_factory("plan", PlanSkill)

        registry.clear()

        # Registry should be empty
        assert len(registry._skills) == 0
        assert len(registry._factories) == 0
        assert registry.get("summarize") is None
        assert registry.get("plan") is None

    def test_get_skill_registry_singleton(self) -> None:
        """Test that get_skill_registry returns a singleton."""
        registry1 = get_skill_registry()
        registry2 = get_skill_registry()

        assert registry1 is registry2

    def test_get_skill_registry_has_builtins(self) -> None:
        """Test that global registry has builtin skills."""
        registry = get_skill_registry()

        # Should have summarize and plan skills
        summarize = registry.get("summarize")
        plan = registry.get("plan")

        assert summarize is not None
        assert isinstance(summarize, SummarizeSkill)
        assert plan is not None
        assert isinstance(plan, PlanSkill)


class TestSummarizeSkill:
    """Test the SummarizeSkill implementation."""

    @pytest.mark.asyncio
    async def test_properties(self) -> None:
        """Test skill properties."""
        skill = SummarizeSkill()

        assert skill.skill_id == "summarize"
        assert skill.name == "Summarize Session"
        assert skill.description == "Create a concise summary of the session history"
        assert skill.mode == SkillMode.SIDE_ACTION
        assert skill.icon == "doc.text"

    @pytest.mark.asyncio
    async def test_execute_empty_session(self) -> None:
        """Test summarizing an empty session."""
        skill = SummarizeSkill()
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=[],
        )

        result = await skill.execute(context)

        assert result.success is True
        assert "No messages in session yet" in result.result
        assert result.error is None

    @pytest.mark.asyncio
    async def test_execute_no_messages(self) -> None:
        """Test summarizing when session_messages is None."""
        skill = SummarizeSkill()
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=None,
        )

        result = await skill.execute(context)

        assert result.success is True
        assert "No messages in session yet" in result.result

    @pytest.mark.asyncio
    async def test_execute_with_messages(self) -> None:
        """Test summarizing a session with messages."""
        skill = SummarizeSkill()
        messages = [
            {"role": "user", "content": "Hello, can you help me?"},
            {"role": "assistant", "content": "Of course! What do you need help with?"},
            {"role": "user", "content": "I need to implement a feature"},
            {"role": "assistant", "content": "Let me help you with that."},
        ]
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=messages,
        )

        result = await skill.execute(context)

        assert result.success is True
        assert "Session Summary" in result.result
        assert "4 total" in result.result
        assert "User: 2" in result.result
        assert "Assistant: 2" in result.result
        assert result.error is None

    @pytest.mark.asyncio
    async def test_execute_includes_first_message(self) -> None:
        """Test that summary includes first user message."""
        skill = SummarizeSkill()
        messages = [
            {"role": "user", "content": "Initial request about testing"},
            {"role": "assistant", "content": "Response"},
        ]
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=messages,
        )

        result = await skill.execute(context)

        assert result.success is True
        assert "Initial request about testing" in result.result

    @pytest.mark.asyncio
    async def test_execute_includes_last_message(self) -> None:
        """Test that summary includes last user message."""
        skill = SummarizeSkill()
        messages = [
            {"role": "user", "content": "First message"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Latest request about features"},
            {"role": "assistant", "content": "Response 2"},
        ]
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=messages,
        )

        result = await skill.execute(context)

        assert result.success is True
        assert "Latest request about features" in result.result

    @pytest.mark.asyncio
    async def test_execute_truncates_long_messages(self) -> None:
        """Test that long messages are truncated in summary."""
        skill = SummarizeSkill()
        long_message = "x" * 150  # More than 100 chars
        messages = [
            {"role": "user", "content": long_message},
            {"role": "assistant", "content": "Response"},
        ]
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=messages,
        )

        result = await skill.execute(context)

        assert result.success is True
        # Should be truncated with ellipsis
        assert "..." in result.result
        # Should not contain full message
        assert long_message not in result.result

    @pytest.mark.asyncio
    async def test_execute_handles_non_string_content(self) -> None:
        """Test handling of non-string message content."""
        skill = SummarizeSkill()
        messages = [
            {"role": "user", "content": ["list", "content"]},  # Non-string
            {"role": "assistant", "content": "Response"},
        ]
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=messages,
        )

        result = await skill.execute(context)

        # Should succeed without crashing
        assert result.success is True


class TestPlanSkill:
    """Test the PlanSkill implementation."""

    @pytest.mark.asyncio
    async def test_properties(self) -> None:
        """Test skill properties."""
        skill = PlanSkill()

        assert skill.skill_id == "plan"
        assert skill.name == "Create Implementation Plan"
        assert skill.description == "Generate a structured plan for implementing a task"
        assert skill.mode == SkillMode.SIDE_ACTION
        assert skill.icon == "list.bullet.clipboard"

    @pytest.mark.asyncio
    async def test_execute_no_args(self) -> None:
        """Test plan generation without arguments."""
        skill = PlanSkill()
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
        )

        result = await skill.execute(context)

        assert result.success is True
        assert "Implementation Plan" in result.result
        assert "Implement the requested feature" in result.result
        assert result.error is None

    @pytest.mark.asyncio
    async def test_execute_with_args(self) -> None:
        """Test plan generation with task description."""
        skill = PlanSkill()
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
        )
        task = "Add user authentication with JWT tokens"

        result = await skill.execute(context, args=task)

        assert result.success is True
        assert "Implementation Plan" in result.result
        assert task in result.result

    @pytest.mark.asyncio
    async def test_execute_includes_sections(self) -> None:
        """Test that plan includes all expected sections."""
        skill = PlanSkill()
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
        )

        result = await skill.execute(context)

        assert result.success is True
        # Check for all main sections
        assert "## Analysis" in result.result
        assert "## Implementation Steps" in result.result
        assert "**Testing**" in result.result  # Sub-section under Implementation Steps
        assert "## Verification" in result.result
        assert "## Dependencies" in result.result
        assert "## Notes" in result.result

    @pytest.mark.asyncio
    async def test_execute_includes_verification_checklist(self) -> None:
        """Test that plan includes verification checklist."""
        skill = PlanSkill()
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
        )

        result = await skill.execute(context)

        assert result.success is True
        # Check for checklist items
        assert "- [ ] All tests pass" in result.result
        assert "- [ ] Type checking passes" in result.result
        assert "- [ ] Linting passes" in result.result

    @pytest.mark.asyncio
    async def test_execute_includes_implementation_steps(self) -> None:
        """Test that plan includes implementation steps."""
        skill = PlanSkill()
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
        )

        result = await skill.execute(context)

        assert result.success is True
        # Check for numbered steps
        assert "1. **Setup**" in result.result
        assert "2. **Core Implementation**" in result.result
        assert "3. **Testing**" in result.result
        assert "4. **Documentation**" in result.result


class TestSkillBase:
    """Test the base Skill interface."""

    def test_skill_mode_enum(self) -> None:
        """Test SkillMode enum values."""
        assert SkillMode.SIDE_ACTION == "side_action"
        assert SkillMode.AGENT_RUN == "agent_run"

    def test_skill_context_creation(self) -> None:
        """Test creating a SkillContext."""
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session-123",
            selected_node_id="node-456",
            session_messages=[{"role": "user", "content": "test"}],
        )

        assert context.workspace_path == "/test/workspace"
        assert context.session_id == "test-session-123"
        assert context.selected_node_id == "node-456"
        assert context.session_messages is not None
        assert len(context.session_messages) == 1

    def test_skill_context_optional_fields(self) -> None:
        """Test SkillContext with optional fields."""
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
        )

        assert context.selected_node_id is None
        assert context.session_messages is None

    def test_skill_result_success(self) -> None:
        """Test creating a successful SkillResult."""
        result = SkillResult(success=True, result="Operation completed")

        assert result.success is True
        assert result.result == "Operation completed"
        assert result.error is None

    def test_skill_result_failure(self) -> None:
        """Test creating a failed SkillResult."""
        result = SkillResult(
            success=False, result="", error="Something went wrong"
        )

        assert result.success is False
        assert result.result == ""
        assert result.error == "Something went wrong"

    @pytest.mark.asyncio
    async def test_skill_abstract_methods(self) -> None:
        """Test that Skill ABC requires abstract methods."""
        # Cannot instantiate Skill directly
        with pytest.raises(TypeError):
            Skill()  # type: ignore


class TestSkillRegistryIntegration:
    """Integration tests for the skills system."""

    @pytest.mark.asyncio
    async def test_end_to_end_skill_execution(self) -> None:
        """Test full flow: register -> retrieve -> execute."""
        registry = SkillRegistry()
        registry.register_factory("summarize", SummarizeSkill)

        # Retrieve skill
        skill = registry.get("summarize")
        assert skill is not None

        # Execute skill
        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
            session_messages=[
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there!"},
            ],
        )
        result = await skill.execute(context)

        assert result.success is True
        assert "Session Summary" in result.result

    @pytest.mark.asyncio
    async def test_multiple_skill_executions(self) -> None:
        """Test executing multiple skills from the registry."""
        registry = SkillRegistry()
        registry.register_factory("summarize", SummarizeSkill)
        registry.register_factory("plan", PlanSkill)

        context = SkillContext(
            workspace_path="/test/workspace",
            session_id="test-session",
        )

        # Execute summarize
        summarize = registry.get("summarize")
        assert summarize is not None
        summary_result = await summarize.execute(context)
        assert summary_result.success is True

        # Execute plan
        plan = registry.get("plan")
        assert plan is not None
        plan_result = await plan.execute(context, args="Implement feature X")
        assert plan_result.success is True

        # Verify both produced different results
        assert summary_result.result != plan_result.result
        assert "Summary" in summary_result.result
        assert "Implementation Plan" in plan_result.result
