# Smithers 🤖

**Build AI agent workflows the way you build software.**

Smithers is a Python framework for composing LLM agents into type-safe, cacheable, parallel workflows. Think Bazel, but for AI agents.

```bash
pip install smithers
```

[![PyPI](https://img.shields.io/pypi/v/smithers.svg)](https://pypi.org/project/smithers/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Why Smithers?

Most agent frameworks are either too simple (single agent, no composition) or too complex (state machines, manual wiring). Smithers takes a different approach:

- **🎯 Deps as function params** — No manual wiring. Type hints ARE the dependency graph.
- **⚡ Automatic parallelism** — Independent workflows run concurrently. Derived from deps.
- **💾 Built-in caching** — Hash inputs, skip unchanged work. Like Bazel's remote cache.
- **🔒 Fully typed** — Pydantic models define contracts between workflows. Catch errors at write-time.
- **📊 Visualize before running** — See the execution graph. Approve the plan. Then execute.

---

## Quick Start

```python
from pydantic import BaseModel
from smithers import workflow, claude, build_graph, run_graph

# Define your outputs as Pydantic models
class AnalysisOutput(BaseModel):
    files: list[str]
    summary: str

class ImplementOutput(BaseModel):
    changed_files: list[str]

# Workflows are just async functions
@workflow
async def analyze() -> AnalysisOutput:
    return await claude(
        "Analyze the codebase and identify files that need changes",
        tools=["Read", "Grep", "Glob"],
        output=AnalysisOutput,
    )

# Dependencies are inferred from type hints!
@workflow
async def implement(analysis: AnalysisOutput) -> ImplementOutput:
    return await claude(
        f"Implement fixes for these files: {', '.join(analysis.files)}",
        tools=["Read", "Edit"],
        output=ImplementOutput,
    )

# Build the graph, visualize it, run it
async def main():
    graph = build_graph(implement)  # Automatically includes `analyze` as dep
    
    print(graph.mermaid())  # Visualize before running
    
    result = await run_graph(graph)
    print(result.changed_files)
```

---

## Core Concepts

### Workflows

A workflow is an async function decorated with `@workflow` that returns a Pydantic model:

```python
from smithers import workflow, claude

class ReviewOutput(BaseModel):
    approved: bool
    comments: list[str]

@workflow
async def review() -> ReviewOutput:
    return await claude(
        "Review this code for bugs and style issues",
        tools=["Read", "Grep"],
        output=ReviewOutput,
    )
```

### Dependencies

Dependencies are declared via function parameters. Smithers inspects type hints to build the graph:

```python
@workflow
async def analyze() -> AnalysisOutput:
    ...

@workflow
async def implement(analysis: AnalysisOutput) -> ImplementOutput:
    # `analysis` is automatically resolved from the `analyze` workflow
    return await claude(f"Fix: {analysis.files}", output=ImplementOutput)

@workflow
async def test(impl: ImplementOutput) -> TestOutput:
    # `impl` comes from `implement`, which depends on `analyze`
    return await claude(f"Test: {impl.changed_files}", output=TestOutput)
```

The dependency graph is:
```
analyze → implement → test
```

### Parallel Execution

Independent workflows run in parallel automatically:

```python
@workflow
async def lint(impl: ImplementOutput) -> LintOutput:
    ...

@workflow
async def test(impl: ImplementOutput) -> TestOutput:
    ...

@workflow
async def deploy(lint: LintOutput, test: TestOutput) -> DeployOutput:
    ...

# Graph structure:
#
#            ┌→ lint ──┐
# implement ─┤         ├→ deploy
#            └→ test ──┘
#
# `lint` and `test` run in parallel!
```

### Caching

Smithers can cache workflow results based on input hashes:

```python
from smithers import run_graph, SqliteCache

cache = SqliteCache("./smithers_cache.db")

# First run: executes all workflows
result = await run_graph(graph, cache=cache)

# Second run: skips workflows with unchanged inputs
result = await run_graph(graph, cache=cache)  # ⚡ Instant
```

---

## The Graph

### Building

```python
from smithers import build_graph

# Build from a target workflow (includes all deps)
graph = build_graph(deploy)

# Inspect the graph
print(graph.nodes)   # {'analyze', 'implement', 'lint', 'test', 'deploy'}
print(graph.edges)   # [('analyze', 'implement'), ('implement', 'lint'), ...]
print(graph.levels)  # [['analyze'], ['implement'], ['lint', 'test'], ['deploy']]
```

### Visualization

```python
# Mermaid diagram
print(graph.mermaid())

# Output:
# ```mermaid
# graph LR
#     analyze --> implement
#     implement --> lint
#     implement --> test
#     lint --> deploy
#     test --> deploy
# ```
```

### Execution

```python
from smithers import run_graph

# Basic execution
result = await run_graph(graph)

# With options
result = await run_graph(
    graph,
    cache=SqliteCache("./cache.db"),   # Enable caching
    max_concurrency=4,                   # Limit parallel workers
    timeout=300,                         # Global timeout in seconds
)
```

---

## Claude Integration

### Basic Usage

```python
from smithers import claude

result = await claude(
    "Summarize this document",
    output=SummaryOutput,
)
```

### With Tools

```python
result = await claude(
    "Find all TODO comments and fix them",
    tools=["Read", "Edit", "Grep", "Glob", "Bash"],
    output=FixOutput,
)
```

### Custom System Prompt

```python
result = await claude(
    "Review this PR",
    system="You are a senior engineer focused on security.",
    output=ReviewOutput,
)
```

### Max Turns

```python
result = await claude(
    "Implement this feature",
    tools=["Read", "Edit", "Bash"],
    max_turns=20,  # Limit tool-use iterations
    output=ImplementOutput,
)
```

---

## Advanced Patterns

### Dynamic Prompts

Access dependency outputs in your prompt:

```python
@workflow
async def implement(analysis: AnalysisOutput) -> ImplementOutput:
    return await claude(
        f"""
        Based on this analysis:
        
        Summary: {analysis.summary}
        Files to modify: {', '.join(analysis.files)}
        
        Implement the necessary fixes.
        """,
        tools=["Read", "Edit"],
        output=ImplementOutput,
    )
```

### Multiple Dependencies

```python
@workflow
async def final_report(
    analysis: AnalysisOutput,
    impl: ImplementOutput,
    tests: TestOutput,
    review: ReviewOutput,
) -> ReportOutput:
    return await claude(
        f"""
        Generate a final report:
        - Analysis: {analysis.summary}
        - Changes: {impl.changed_files}
        - Tests: {'passed' if tests.passed else 'failed'}
        - Review: {'approved' if review.approved else 'needs work'}
        """,
        output=ReportOutput,
    )
```

### Fan-Out / Fan-In

```python
class FileAnalysis(BaseModel):
    file: str
    issues: list[str]

class AggregatedAnalysis(BaseModel):
    all_issues: list[FileAnalysis]

@workflow
async def analyze_file(file: str) -> FileAnalysis:
    return await claude(f"Analyze {file}", output=FileAnalysis)

@workflow
async def aggregate(analyses: list[FileAnalysis]) -> AggregatedAnalysis:
    return AggregatedAnalysis(all_issues=analyses)

# Create workflows for each file
files = ["auth.py", "api.py", "db.py"]
file_workflows = [analyze_file.bind(file=f) for f in files]

# Fan-in to aggregate
graph = build_graph(aggregate.bind(analyses=file_workflows))
```

### Conditional Workflows

```python
from smithers import workflow, skip

@workflow
async def maybe_deploy(
    tests: TestOutput,
    review: ReviewOutput,
) -> DeployOutput | None:
    if not tests.passed:
        return skip("Tests failed")
    if not review.approved:
        return skip("Review not approved")
    
    return await claude("Deploy to production", output=DeployOutput)
```

### Human-in-the-Loop

```python
from smithers import workflow, require_approval

@workflow
@require_approval("About to deploy to production. Proceed?")
async def deploy(impl: ImplementOutput) -> DeployOutput:
    return await claude("Deploy to production", output=DeployOutput)
```

---

## State Management

Smithers uses SQLite as the source of truth. The core loop:

```python
from smithers import SqliteState, build_plan, run_plan

state = SqliteState("./smithers.db")

# The loop
while True:
    # 1. Read current state
    current = await state.get()
    
    # 2. Render a plan from state
    plan = build_plan(current)
    
    if plan.is_empty():
        break
    
    # 3. Execute the plan
    result = await run_plan(plan)
    
    # 4. Update state (triggers re-render)
    await state.update(result)
```

---

## CLI

```bash
# Run a workflow file
smithers run workflow.py

# Visualize the graph
smithers graph workflow.py --output graph.md

# Run with caching
smithers run workflow.py --cache ./cache.db

# Dry run (show plan without executing)
smithers run workflow.py --dry-run
```

---

## Configuration

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-...          # Required for Claude
SMITHERS_CACHE_DIR=./cache        # Default cache location
SMITHERS_MAX_CONCURRENCY=8        # Max parallel workflows
SMITHERS_LOG_LEVEL=info           # Logging level
```

### Programmatic

```python
from smithers import configure

configure(
    model="claude-sonnet-4-20250514",
    max_concurrency=4,
    cache_dir="./cache",
)
```

---

## Comparison

| Feature | Smithers | LangGraph | CrewAI | Pydantic AI |
|---------|----------|-----------|--------|-------------|
| Deps from type hints | ✅ | ❌ | ❌ | ❌ |
| Automatic parallelism | ✅ | ❌ | ❌ | ❌ |
| Built-in caching | ✅ | ❌ | ❌ | ❌ |
| Pydantic-native | ✅ | ❌ | ❌ | ✅ |
| Visualization | ✅ | ✅ | ❌ | ✅ |
| Human-in-the-loop | ✅ | ✅ | ✅ | ✅ |

---

## Examples

See the [examples/](./examples) directory:

- [simple.py](./examples/simple.py) — Basic workflow
- [parallel.py](./examples/parallel.py) — Parallel execution
- [caching.py](./examples/caching.py) — Cached workflows
- [code-review.py](./examples/code-review.py) — Multi-agent code review
- [research.py](./examples/research.py) — Deep research agent

---

## License

MIT © 2025 Smithers Contributors
