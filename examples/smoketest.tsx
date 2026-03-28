/**
 * <Smoketest> — Setup environment → Run smoke checks → Generate report.
 *
 * Pattern: Provision → Execute checks → Aggregate pass/fail → Report.
 * Use cases: release validation, deploy verification, environment health checks.
 */
import { createSmithers, Sequence, Parallel } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { bash, read } from "smithers-orchestrator/tools";
import { z } from "zod";

const setupSchema = z.object({
  environment: z.string(),
  ready: z.boolean(),
  details: z.string(),
});

const checkSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  duration: z.number(),
  error: z.string().optional(),
  output: z.string(),
});

const reportSchema = z.object({
  totalChecks: z.number(),
  passed: z.number(),
  failed: z.number(),
  duration: z.number(),
  verdict: z.enum(["pass", "fail"]),
  failures: z.array(z.string()),
  summary: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  setup: setupSchema,
  check: checkSchema,
  report: reportSchema,
});

const setupAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { bash, read },
  instructions: `You are an environment setup agent. Prepare the test environment.
Install dependencies, start services, verify connectivity.`,
});

const checkAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { bash, read },
  instructions: `You are a smoke test runner. Execute the specified check and report
pass/fail with timing. Be precise about errors.`,
});

export default smithers((ctx) => {
  const setup = ctx.outputMaybe("setup", { nodeId: "setup" });
  const checks = ctx.outputs.check ?? [];

  // Default checks if none specified
  const smokeChecks = ctx.input.checks ?? [
    { name: "typecheck", cmd: "npx tsc --noEmit" },
    { name: "lint", cmd: "npx eslint ." },
    { name: "test", cmd: "npm test" },
    { name: "build", cmd: "npm run build" },
  ];

  return (
    <Workflow name="smoketest">
      <Sequence>
        <Task id="setup" output={outputs.setup} agent={setupAgent}>
          {`Setup test environment at "${ctx.input.directory}":
${ctx.input.setupCmd ?? "npm install"}
Verify the environment is ready for smoke testing.`}
        </Task>

        {setup?.ready && (
          <Parallel maxConcurrency={ctx.input.maxParallel ?? 4}>
            {smokeChecks.map((check: { name: string; cmd: string }) => (
              <Task
                key={check.name}
                id={`check-${check.name}`}
                output={outputs.check}
                agent={checkAgent}
                continueOnFail
                timeoutMs={ctx.input.timeoutMs ?? 120_000}
              >
                {`Run smoke check "${check.name}":
Command: ${check.cmd}
Directory: ${ctx.input.directory}
Report pass/fail with timing.`}
              </Task>
            ))}
          </Parallel>
        )}

        <Task id="report" output={outputs.report}>
          {{
            totalChecks: checks.length,
            passed: checks.filter((c) => c.passed).length,
            failed: checks.filter((c) => !c.passed).length,
            duration: checks.reduce((sum, c) => sum + c.duration, 0),
            verdict: checks.every((c) => c.passed) ? "pass" as const : "fail" as const,
            failures: checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.error ?? "failed"}`),
            summary: `${checks.filter((c) => c.passed).length}/${checks.length} checks passed`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
