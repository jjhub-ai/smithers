"""
Plan skill - creates an implementation plan for a task.

This skill analyzes a task or request and produces a structured plan
with steps, dependencies, and verification criteria.
"""

from agentd.skills.base import Skill, SkillContext, SkillMode, SkillResult


class PlanSkill(Skill):
    """
    Skill that creates an implementation plan.

    Produces a markdown artifact with:
    - Task breakdown
    - Implementation steps
    - Dependencies
    - Verification criteria
    """

    @property
    def skill_id(self) -> str:
        return "plan"

    @property
    def name(self) -> str:
        return "Create Implementation Plan"

    @property
    def description(self) -> str:
        return "Generate a structured plan for implementing a task"

    @property
    def mode(self) -> SkillMode:
        return SkillMode.SIDE_ACTION

    @property
    def icon(self) -> str | None:
        return "list.bullet.clipboard"

    async def execute(self, context: SkillContext, args: str | None = None) -> SkillResult:
        """
        Generate an implementation plan.

        Args:
            context: Execution context
            args: Task description to plan for

        Returns:
            SkillResult with markdown plan
        """
        # For MVP, create a simple template plan
        # In v2, this would use an LLM to generate a real plan based on the task
        task_description = args or "Implement the requested feature"

        plan_lines = [
            "# Implementation Plan",
            "",
            f"**Task**: {task_description}",
            "",
            "## Analysis",
            "",
            "- Review existing code and architecture",
            "- Identify affected components",
            "- Consider edge cases and error handling",
            "",
            "## Implementation Steps",
            "",
            "1. **Setup**",
            "   - Create necessary files and directories",
            "   - Add required dependencies",
            "",
            "2. **Core Implementation**",
            "   - Implement main functionality",
            "   - Add error handling",
            "   - Follow existing patterns",
            "",
            "3. **Testing**",
            "   - Write unit tests",
            "   - Test edge cases",
            "   - Verify integration",
            "",
            "4. **Documentation**",
            "   - Update relevant docs",
            "   - Add code comments where needed",
            "",
            "## Verification",
            "",
            "- [ ] All tests pass",
            "- [ ] Type checking passes",
            "- [ ] Linting passes",
            "- [ ] Manual testing complete",
            "",
            "## Dependencies",
            "",
            "- Ensure all prerequisite tasks are completed",
            "- Review related code before starting",
            "",
            "## Notes",
            "",
            "- Keep changes focused and atomic",
            "- Test incrementally during development",
            "- Commit early and often",
        ]

        plan = "\n".join(plan_lines)

        return SkillResult(success=True, result=plan)
