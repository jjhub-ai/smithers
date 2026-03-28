/**
 * <Scaffold> — Generate project/feature structure from a template or spec.
 *
 * Pattern: Read spec → plan structure → generate files → verify.
 * Use cases: new project setup, feature scaffolding, component generation,
 * API endpoint generation, test file generation.
 */
import { createSmithers, Sequence, Parallel } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, write, bash, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

const blueprintSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    type: z.enum(["component", "test", "config", "types", "util", "route", "style"]),
    description: z.string(),
    template: z.string().optional(),
  })),
  directories: z.array(z.string()),
  totalFiles: z.number(),
});

const fileGenSchema = z.object({
  path: z.string(),
  created: z.boolean(),
  linesOfCode: z.number(),
  summary: z.string(),
});

const verifySchema = z.object({
  typecheck: z.boolean(),
  compiles: z.boolean(),
  errors: z.array(z.string()),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  blueprint: blueprintSchema,
  fileGen: fileGenSchema,
  verify: verifySchema,
});

const architect = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep },
  instructions: `You are a software architect. Analyze existing patterns in the codebase
and design a file structure that matches the project's conventions. List every file
that needs to be created with its purpose.`,
});

const generator = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, write, grep },
  instructions: `You are a code generator. Create the specified file following the project's
existing patterns and conventions. Match the style of surrounding code.`,
});

const verifier = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { bash },
  instructions: `Verify the generated files compile and type-check correctly.`,
});

export default smithers((ctx) => {
  const blueprint = ctx.outputMaybe("blueprint", { nodeId: "blueprint" });
  const generated = ctx.outputs.fileGen ?? [];

  return (
    <Workflow name="scaffold">
      <Sequence>
        <Task id="blueprint" output={outputs.blueprint} agent={architect}>
          {`Design file structure for:

Feature: ${ctx.input.feature}
Type: ${ctx.input.type ?? "feature"}
Directory: ${ctx.input.directory}

Analyze existing patterns in the codebase (look at similar features).
List every file that needs to be created.
${ctx.input.spec ? `Spec:\n${ctx.input.spec}` : ""}`}
        </Task>

        {blueprint && (
          <Parallel maxConcurrency={5}>
            {blueprint.files.map((file) => (
              <Task
                key={file.path}
                id={`gen-${file.path.replace(/\//g, "-")}`}
                output={outputs.fileGen}
                agent={generator}
                continueOnFail
              >
                {`Generate file: ${file.path}
Type: ${file.type}
Purpose: ${file.description}
${file.template ? `Template:\n${file.template}` : "Match existing project patterns."}
Directory: ${ctx.input.directory}`}
              </Task>
            ))}
          </Parallel>
        )}

        {generated.length > 0 && (
          <Task id="verify" output={outputs.verify} agent={verifier}>
            {`Verify generated files:
Directory: ${ctx.input.directory}
Command: ${ctx.input.verifyCmd ?? "npx tsc --noEmit"}`}
          </Task>
        )}
      </Sequence>
    </Workflow>
  );
});
