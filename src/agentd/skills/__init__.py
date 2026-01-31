"""
Skills system for agent side actions and orchestration.

Skills are named actions that the agent can execute, either as side actions
(producing artifacts) or as agent runs (creating run nodes).
"""

from agentd.skills.base import Skill, SkillMode, SkillResult
from agentd.skills.registry import SkillRegistry, get_skill_registry

__all__ = [
    "Skill",
    "SkillMode",
    "SkillRegistry",
    "SkillResult",
    "get_skill_registry",
]
