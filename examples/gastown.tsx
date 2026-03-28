/**
 * Gas Town Clone — Multi-agent orchestration à la Steve Yegge's Gas Town,
 * implemented in ~150 lines of Smithers JSX.
 *
 * Demonstrates that Smithers' built-in primitives (Parallel, Worktree,
 * MergeQueue, retries, durability) replace Gas Town's entire custom
 * orchestration layer (Mayor, Polecats, Refinery, Witness, Beads).
 */
import {
  createSmithers,
  Sequence,
  Parallel,
  MergeQueue,
  Worktree,
} from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, write, edit, bash, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas — these ARE the "Beads" (persistent, durable state per task)
// ---------------------------------------------------------------------------

const taskItem = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  files: z.array(z.string()),
});

const planSchema = z.object({
  tasks: z.array(taskItem),
});

const workerResultSchema = z.object({
  taskId: z.string(),
  branch: z.string(),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  status: z.enum(["success", "partial", "failed"]),
});

const mergeResultSchema = z.object({
  branch: z.string(),
  merged: z.boolean(),
  conflicts: z.array(z.string()),
  resolution: z.string(),
});

const finalReportSchema = z.object({
  totalTasks: z.number(),
  merged: z.number(),
  failed: z.number(),
  summary: z.string(),
});

// ---------------------------------------------------------------------------
// Create Smithers (schema → typed API + durable SQLite tables)
// ---------------------------------------------------------------------------

const { Workflow, Task, smithers, outputs } = createSmithers({
  plan: planSchema,
  workerResult: workerResultSchema,
  mergeResult: mergeResultSchema,
  finalReport: finalReportSchema,
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const mayorAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep, bash },
  instructions: `You are the Mayor — a project planning agent.
Analyze the codebase and break the user's goal into small, independent tasks
that can be executed in parallel by separate agents, each in its own git worktree.

Each task should:
- Have a short, unique kebab-case id (e.g. "add-auth-middleware")
- Touch a distinct set of files (no overlap between tasks)
- Be completable by a single agent in one pass

Output a JSON plan with an array of tasks.`,
});

const polecatAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, write, edit, bash, grep },
  instructions: `You are a Polecat — a worker agent executing a single code task
in an isolated git worktree. You have full read/write access.

Complete the task described in your prompt. Make clean, minimal changes.
Commit your work when done. Report what you changed.`,
});

const refineryAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { bash, read, grep },
  instructions: `You are the Refinery — a merge agent.
Merge the given feature branch into the base branch.
If there are conflicts, resolve them intelligently.
Report whether the merge succeeded and any conflicts encountered.`,
});

const reportAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  instructions: `Summarize the results of a multi-agent coding session.
Be concise: total tasks, how many merged, how many failed, and a brief summary.`,
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export default smithers((ctx) => {
  // Mayor's plan (available after first task completes and tree re-renders)
  const plan = ctx.outputMaybe("plan", { nodeId: "mayor" });

  // Collect completed worker results for the merge phase
  const workerResults = ctx.outputs.workerResult ?? [];
  const mergeResults = ctx.outputs.mergeResult ?? [];

  return (
    <Workflow name="gastown">
      <Sequence>
        {/* ── Mayor: decompose the goal into parallel tasks ── */}
        <Task id="mayor" output={outputs.plan} agent={mayorAgent}>
          {`Analyze the codebase at "${ctx.input.directory}" and break this goal
into independent, parallelizable tasks:

Goal: ${ctx.input.goal}

Return a JSON plan. Keep tasks small and non-overlapping.`}
        </Task>

        {/* ── Polecats: parallel workers, each in its own worktree ── */}
        {plan && (
          <Parallel maxConcurrency={ctx.input.maxAgents ?? 5}>
            {plan.tasks.map((task) => (
              <Worktree
                key={task.id}
                path={`.worktrees/${task.id}`}
                branch={`polecat/${task.id}`}
              >
                <Task
                  id={`polecat-${task.id}`}
                  output={outputs.workerResult}
                  agent={polecatAgent}
                  retries={1}
                  timeoutMs={300_000}
                  continueOnFail
                >
                  {`Task: ${task.title}

${task.description}

Files to focus on: ${task.files.join(", ")}

Work in your isolated worktree. Commit when done.`}
                </Task>
              </Worktree>
            ))}
          </Parallel>
        )}

        {/* ── Refinery: serialized merge queue ── */}
        {workerResults.length > 0 && (
          <MergeQueue id="refinery" maxConcurrency={1}>
            {workerResults
              .filter((r) => r.status !== "failed")
              .map((result) => (
                <Task
                  key={result.branch}
                  id={`merge-${result.taskId}`}
                  output={outputs.mergeResult}
                  agent={refineryAgent}
                  retries={1}
                >
                  {`Merge branch "${result.branch}" into main.
Changes made: ${result.summary}
Files changed: ${result.filesChanged.join(", ")}

Resolve any conflicts. Report the result.`}
                </Task>
              ))}
          </MergeQueue>
        )}

        {/* ── Final report ── */}
        <Task id="report" output={outputs.finalReport} agent={reportAgent}>
          {`Summarize this multi-agent session:

Total tasks planned: ${plan?.tasks.length ?? 0}
Worker results: ${JSON.stringify(workerResults.map((r) => ({ id: r.taskId, status: r.status })))}
Merge results: ${JSON.stringify(mergeResults.map((r) => ({ branch: r.branch, merged: r.merged })))}

Provide a concise final report.`}
        </Task>
      </Sequence>
    </Workflow>
  );
});
