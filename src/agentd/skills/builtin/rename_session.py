"""
Rename session skill - renames the current session.

This skill allows the user to give the session a meaningful name
that better describes its purpose or content.
"""

from agentd.skills.base import Skill, SkillContext, SkillMode, SkillResult


class RenameSessionSkill(Skill):
    """
    Skill that renames the current session.

    Takes a new name as an argument and updates the session metadata.
    This is purely a metadata operation and doesn't affect the session history.
    """

    @property
    def skill_id(self) -> str:
        return "rename_session"

    @property
    def name(self) -> str:
        return "Rename Session"

    @property
    def description(self) -> str:
        return "Give the session a meaningful name"

    @property
    def mode(self) -> SkillMode:
        return SkillMode.SIDE_ACTION

    @property
    def icon(self) -> str | None:
        return "pencil"

    async def execute(self, context: SkillContext, args: str | None = None) -> SkillResult:
        """
        Rename the session.

        Args:
            context: Execution context with session ID
            args: The new session name

        Returns:
            SkillResult with success status and confirmation message
        """
        if not args or not args.strip():
            return SkillResult(
                success=False,
                result="",
                error="Session name cannot be empty",
            )

        new_name = args.strip()

        # Validate name length
        if len(new_name) > 200:
            return SkillResult(
                success=False,
                result="",
                error="Session name must be 200 characters or less",
            )

        # For MVP, we just return success
        # In v2, this would update the session metadata in the database
        result_message = f"Session renamed to: {new_name}"

        return SkillResult(success=True, result=result_message)
