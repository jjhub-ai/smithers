/**
 * <Plan> — Agent analyzes context and produces a structured, prioritized action plan.
 *
 * Pattern: Analyze requirements → decompose into tasks → prioritize → output plan.
 * Use cases: feature planning, sprint planning, migration planning, refactor strategy.
 */
import { createSmithers, Sequence } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, grep, bash } from "smithers-orchestrator/tools";
import { z } from "zod";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(["p0", "p1", "p2"]),
  estimatedComplexity: z.enum(["trivial", "small", "medium", "large"]),
  dependencies: z.array(z.string()),
  files: z.array(z.string()),
});

const planSchema = z.object({
  goal: z.string(),
  tasks: z.array(taskSchema),
  criticalPath: z.array(z.string()),
  risks: z.array(z.string()),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  plan: planSchema,
});

const planner = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep, bash },
  instructions: `You are a technical architect. Analyze the codebase and requirements,
then produce a detailed implementation plan. Break work into small, independent tasks.
Identify the critical path and risks. Each task should be completable by a single agent.`,
});

export default smithers((ctx) => (
  <Workflow name="plan">
    <Task id="plan" output={outputs.plan} agent={planner}>
      {`Analyze the codebase at "${ctx.input.directory}" and create an implementation plan for:

Goal: ${ctx.input.goal}

Requirements:
${ctx.input.requirements ?? "See codebase for context"}

Constraints:
${ctx.input.constraints ?? "None specified"}

Break this into small, parallelizable tasks. Identify dependencies and critical path.`}
    </Task>
  </Workflow>
));
