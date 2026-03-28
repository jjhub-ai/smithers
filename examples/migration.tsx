/**
 * <Migration> — Plan → Transform files → Validate → Report.
 *
 * Pattern: Analyze what needs migrating → Apply transforms → Verify nothing broke.
 * Use cases: API version upgrades, framework migrations, dependency updates,
 * config format changes, database schema migrations.
 */
import {
  createSmithers,
  Sequence,
  Parallel,
  Loop,
} from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, write, edit, bash, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

const migrationPlanSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    changeType: z.enum(["modify", "rename", "delete", "create"]),
    description: z.string(),
    complexity: z.enum(["trivial", "moderate", "complex"]),
  })),
  breakingChanges: z.array(z.string()),
  totalFiles: z.number(),
});

const fileResultSchema = z.object({
  path: z.string(),
  status: z.enum(["migrated", "failed", "skipped"]),
  changes: z.string(),
  error: z.string().optional(),
});

const validationSchema = z.object({
  passed: z.boolean(),
  typecheck: z.boolean(),
  tests: z.boolean(),
  lint: z.boolean(),
  errors: z.array(z.string()),
});

const reportSchema = z.object({
  totalFiles: z.number(),
  migrated: z.number(),
  failed: z.number(),
  skipped: z.number(),
  validationPassed: z.boolean(),
  summary: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  migrationPlan: migrationPlanSchema,
  fileResult: fileResultSchema,
  validation: validationSchema,
  report: reportSchema,
});

const analyzer = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep, bash },
  instructions: `You are a migration analyst. Scan the codebase to find all files
that need changes for the migration. Assess complexity and identify breaking changes.`,
});

const migrator = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, write, edit, grep },
  instructions: `You are a code migrator. Apply the specified migration to the given file.
Make minimal, precise changes. Preserve formatting and comments.`,
});

const validator = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { bash },
  instructions: `You are a CI validator. Run typecheck, tests, and lint to verify
the migration didn't break anything. Report all errors found.`,
});

export default smithers((ctx) => {
  const plan = ctx.outputMaybe("migrationPlan", { nodeId: "analyze" });
  const fileResults = ctx.outputs.fileResult ?? [];
  const validation = ctx.outputMaybe("validation", { nodeId: "validate" });

  return (
    <Workflow name="migration">
      <Sequence>
        {/* Analyze: what needs to change */}
        <Task id="analyze" output={outputs.migrationPlan} agent={analyzer}>
          {`Analyze the codebase at "${ctx.input.directory}" for this migration:

From: ${ctx.input.from}
To: ${ctx.input.to}

Migration guide:
${ctx.input.guide ?? "Determine changes needed based on the version diff"}

Find ALL files that need changes. Assess complexity of each.`}
        </Task>

        {/* Transform: apply changes in parallel batches */}
        {plan && (
          <Parallel maxConcurrency={5}>
            {plan.files.map((file) => (
              <Task
                key={file.path}
                id={`migrate-${file.path.replace(/\//g, "-")}`}
                output={outputs.fileResult}
                agent={migrator}
                continueOnFail
                retries={1}
              >
                {`Migrate this file:
Path: ${file.path}
Change type: ${file.changeType}
Description: ${file.description}

Migration: ${ctx.input.from} → ${ctx.input.to}
${ctx.input.guide ?? ""}`}
              </Task>
            ))}
          </Parallel>
        )}

        {/* Validate: ensure nothing is broken */}
        {fileResults.length > 0 && (
          <Task id="validate" output={outputs.validation} agent={validator}>
            {`Run validation checks in "${ctx.input.directory}":

1. Typecheck: ${ctx.input.typecheckCmd ?? "npx tsc --noEmit"}
2. Tests: ${ctx.input.testCmd ?? "npm test"}
3. Lint: ${ctx.input.lintCmd ?? "npx eslint ."}

Report pass/fail for each.`}
          </Task>
        )}

        {/* Report */}
        <Task id="report" output={outputs.report}>
          {{
            totalFiles: plan?.totalFiles ?? 0,
            migrated: fileResults.filter((r) => r.status === "migrated").length,
            failed: fileResults.filter((r) => r.status === "failed").length,
            skipped: fileResults.filter((r) => r.status === "skipped").length,
            validationPassed: validation?.passed ?? false,
            summary: `Migration ${ctx.input.from} → ${ctx.input.to}: ${fileResults.filter((r) => r.status === "migrated").length}/${plan?.totalFiles ?? 0} files migrated, validation ${validation?.passed ? "passed" : "failed"}`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
