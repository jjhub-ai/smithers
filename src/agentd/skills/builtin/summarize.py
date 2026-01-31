"""
Summarize skill - creates a concise summary of the session.

This skill analyzes the session history and produces a markdown summary
of what has been discussed and accomplished.
"""

from agentd.skills.base import Skill, SkillContext, SkillMode, SkillResult


class SummarizeSkill(Skill):
    """
    Skill that summarizes the current session.

    Produces a markdown artifact with:
    - Key topics discussed
    - Decisions made
    - Actions taken
    - Outstanding questions
    """

    @property
    def skill_id(self) -> str:
        return "summarize"

    @property
    def name(self) -> str:
        return "Summarize Session"

    @property
    def description(self) -> str:
        return "Create a concise summary of the session history"

    @property
    def mode(self) -> SkillMode:
        return SkillMode.SIDE_ACTION

    @property
    def icon(self) -> str | None:
        return "doc.text"

    async def execute(self, context: SkillContext, args: str | None = None) -> SkillResult:
        """
        Generate a summary of the session.

        Args:
            context: Execution context with session messages
            args: Optional arguments (unused)

        Returns:
            SkillResult with markdown summary
        """
        # For MVP, create a simple summary based on message count
        # In v2, this would use an LLM to generate a real summary
        if not context.session_messages:
            return SkillResult(
                success=True,
                result="# Session Summary\n\nNo messages in session yet.",
            )

        message_count = len(context.session_messages)
        user_messages = [
            m for m in context.session_messages if m.get("role") == "user"
        ]
        assistant_messages = [
            m for m in context.session_messages if m.get("role") == "assistant"
        ]

        # Simple heuristic summary for MVP
        summary_lines = [
            "# Session Summary",
            "",
            f"**Messages**: {message_count} total",
            f"- User: {len(user_messages)}",
            f"- Assistant: {len(assistant_messages)}",
            "",
            "## Recent Topics",
            "",
        ]

        # Add first user message as initial topic
        if user_messages:
            first_msg = user_messages[0].get("content", "")
            if isinstance(first_msg, str):
                preview = first_msg[:100] + "..." if len(first_msg) > 100 else first_msg
                summary_lines.append(f"- Started with: {preview}")

        # Add last user message as current topic
        if len(user_messages) > 1:
            last_msg = user_messages[-1].get("content", "")
            if isinstance(last_msg, str):
                preview = last_msg[:100] + "..." if len(last_msg) > 100 else last_msg
                summary_lines.append(f"- Currently: {preview}")

        summary = "\n".join(summary_lines)

        return SkillResult(success=True, result=summary)
