/**
 * <Refactor> — Analyze → Plan refactor → Apply changes → Validate.
 *
 * Pattern: Static analysis → targeted refactoring → verification.
 * Use cases: rename across codebase, extract interfaces, convert patterns,
 * modernize syntax, split files, consolidate duplicates.
 */
import { createSmithers, Sequence, Parallel } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, write, edit, bash, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

const analysisSchema = z.object({
  targets: z.array(z.object({
    file: z.string(),
    pattern: z.string(),
    occurrences: z.number(),
    complexity: z.enum(["simple", "moderate", "complex"]),
  })),
  totalOccurrences: z.number(),
  estimatedImpact: z.string(),
});

const changeSchema = z.object({
  file: z.string(),
  status: z.enum(["refactored", "skipped", "failed"]),
  changes: z.string(),
  linesChanged: z.number(),
});

const verifySchema = z.object({
  typecheck: z.boolean(),
  tests: z.boolean(),
  lint: z.boolean(),
  errors: z.array(z.string()),
  passed: z.boolean(),
});

const summarySchema = z.object({
  totalTargets: z.number(),
  refactored: z.number(),
  skipped: z.number(),
  failed: z.number(),
  verified: z.boolean(),
  summary: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  analysis: analysisSchema,
  change: changeSchema,
  verify: verifySchema,
  summary: summarySchema,
});

const analyzer = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep, bash },
  instructions: `You are a static analysis agent. Find all occurrences of the pattern
that needs refactoring. Be thorough — don't miss any.`,
});

const refactorer = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, edit, grep },
  instructions: `You are a refactoring agent. Apply the specified refactoring to the given file.
Make precise, minimal changes. Preserve behavior exactly. Don't change formatting
of lines you're not refactoring.`,
});

const verifier = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { bash },
  instructions: `You are a verification agent. Run typecheck, tests, and lint to ensure
the refactoring didn't break anything.`,
});

export default smithers((ctx) => {
  const analysis = ctx.outputMaybe("analysis", { nodeId: "analyze" });
  const changes = ctx.outputs.change ?? [];
  const verification = ctx.outputMaybe("verify", { nodeId: "verify" });

  return (
    <Workflow name="refactor">
      <Sequence>
        <Task id="analyze" output={outputs.analysis} agent={analyzer}>
          {`Find all occurrences of this pattern in "${ctx.input.directory}":

Pattern: ${ctx.input.pattern}
Refactoring: ${ctx.input.refactoring}

Example: ${ctx.input.example ?? "N/A"}

List every file and occurrence that needs changing.`}
        </Task>

        {analysis && (
          <Parallel maxConcurrency={5}>
            {analysis.targets.map((target) => (
              <Task
                key={target.file}
                id={`refactor-${target.file.replace(/\//g, "-")}`}
                output={outputs.change}
                agent={refactorer}
                continueOnFail
              >
                {`Refactor "${target.file}":
Pattern: ${target.pattern} (${target.occurrences} occurrences)
Refactoring: ${ctx.input.refactoring}
${ctx.input.example ? `Example:\nBefore: ${ctx.input.example.before}\nAfter: ${ctx.input.example.after}` : ""}`}
              </Task>
            ))}
          </Parallel>
        )}

        {changes.length > 0 && (
          <Task id="verify" output={outputs.verify} agent={verifier}>
            {`Verify the refactoring didn't break anything:
Directory: ${ctx.input.directory}
1. ${ctx.input.typecheckCmd ?? "npx tsc --noEmit"}
2. ${ctx.input.testCmd ?? "npm test"}
3. ${ctx.input.lintCmd ?? "npx eslint ."}`}
          </Task>
        )}

        <Task id="summary" output={outputs.summary}>
          {{
            totalTargets: analysis?.targets.length ?? 0,
            refactored: changes.filter((c) => c.status === "refactored").length,
            skipped: changes.filter((c) => c.status === "skipped").length,
            failed: changes.filter((c) => c.status === "failed").length,
            verified: verification?.passed ?? false,
            summary: `Refactored ${changes.filter((c) => c.status === "refactored").length}/${analysis?.targets.length ?? 0} files. Verification: ${verification?.passed ? "passed" : "pending/failed"}`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
