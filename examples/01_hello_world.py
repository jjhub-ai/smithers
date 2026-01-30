"""
Example 01: Hello World

The simplest possible Smithers workflow - a single agent that generates a greeting.
"""

from pydantic import BaseModel

from smithers import build_graph, claude, run_graph, workflow


class GreetingOutput(BaseModel):
    greeting: str
    emoji: str


@workflow
async def hello_world() -> GreetingOutput:
    """Generate a friendly greeting."""
    return await claude(
        "Generate a friendly greeting for a developer learning Smithers. "
        "Include an appropriate emoji.",
        output=GreetingOutput,
    )


async def main():
    graph = build_graph(hello_world)
    result = await run_graph(graph)

    print(f"{result.emoji} {result.greeting}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
