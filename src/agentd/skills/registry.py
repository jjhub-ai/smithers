"""
Skill registry for managing available skills.

The registry is the central source of truth for all available skills.
"""

from collections.abc import Callable

from agentd.skills.base import Skill


class SkillRegistry:
    """
    Registry for managing skills.

    Skills are registered by ID and can be looked up for execution.
    """

    def __init__(self) -> None:
        """Initialize an empty skill registry."""
        self._skills: dict[str, Skill] = {}
        self._factories: dict[str, Callable[[], Skill]] = {}

    def register(self, skill: Skill) -> None:
        """
        Register a skill instance.

        Args:
            skill: The skill instance to register
        """
        self._skills[skill.skill_id] = skill

    def register_factory(self, skill_id: str, factory: Callable[[], Skill]) -> None:
        """
        Register a skill factory for lazy instantiation.

        Args:
            skill_id: The skill ID
            factory: Factory function that creates the skill
        """
        self._factories[skill_id] = factory

    def get(self, skill_id: str) -> Skill | None:
        """
        Get a skill by ID.

        Args:
            skill_id: The skill ID to look up

        Returns:
            The skill instance, or None if not found
        """
        # Check if already instantiated
        if skill_id in self._skills:
            return self._skills[skill_id]

        # Try to instantiate from factory
        if skill_id in self._factories:
            skill = self._factories[skill_id]()
            self._skills[skill_id] = skill
            return skill

        return None

    def list_skills(self) -> list[Skill]:
        """
        List all registered skills.

        Instantiates all factory-registered skills if needed.

        Returns:
            List of all skill instances
        """
        # Instantiate all factory skills
        for skill_id, factory in self._factories.items():
            if skill_id not in self._skills:
                self._skills[skill_id] = factory()

        return list(self._skills.values())

    def clear(self) -> None:
        """Clear all registered skills. Useful for testing."""
        self._skills.clear()
        self._factories.clear()


# Global registry instance
_global_registry: SkillRegistry | None = None


def get_skill_registry() -> SkillRegistry:
    """
    Get the global skill registry.

    Returns:
        The global SkillRegistry instance
    """
    global _global_registry
    if _global_registry is None:
        _global_registry = SkillRegistry()
        _register_builtin_skills(_global_registry)
    return _global_registry


def _register_builtin_skills(registry: SkillRegistry) -> None:
    """
    Register built-in skills with the registry.

    This is called once when the global registry is first created.
    """
    # Import here to avoid circular dependencies
    from agentd.skills.builtin.plan import PlanSkill
    from agentd.skills.builtin.rename_session import RenameSessionSkill
    from agentd.skills.builtin.summarize import SummarizeSkill

    # Register factories for lazy instantiation
    registry.register_factory("summarize", SummarizeSkill)
    registry.register_factory("plan", PlanSkill)
    registry.register_factory("rename_session", RenameSessionSkill)
