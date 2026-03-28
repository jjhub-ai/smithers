/**
 * <Waterfall> — Sequential phases where each receives the previous phase's output.
 *
 * Pattern: Phase A → Phase B (using A's output) → Phase C (using B's output).
 * Use cases: multi-stage pipelines, progressive refinement, build pipelines,
 * content pipelines (outline → draft → edit → publish).
 */
import { createSmithers, Sequence } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, write, edit, bash, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

const outlineSchema = z.object({
  sections: z.array(z.object({
    title: z.string(),
    keyPoints: z.array(z.string()),
    estimatedLength: z.number(),
  })),
  totalSections: z.number(),
  targetAudience: z.string(),
});

const draftSchema = z.object({
  content: z.string(),
  wordCount: z.number(),
  sectionsCompleted: z.number(),
});

const editSchema = z.object({
  content: z.string(),
  wordCount: z.number(),
  changesApplied: z.array(z.string()),
  readabilityScore: z.number(),
});

const publishSchema = z.object({
  outputFile: z.string(),
  format: z.string(),
  wordCount: z.number(),
  summary: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  outline: outlineSchema,
  draft: draftSchema,
  edit: editSchema,
  publish: publishSchema,
});

const outliner = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep },
  instructions: `You are a content strategist. Create detailed outlines with clear structure.
Consider the target audience and purpose.`,
});

const drafter = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  instructions: `You are a technical writer. Write high-quality content from outlines.
Follow the structure exactly. Be thorough but concise.`,
});

const editor = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  instructions: `You are an editor. Improve clarity, fix errors, tighten prose.
Don't change the meaning or structure — just make it better.`,
});

const publisher = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { write },
  instructions: `You are a publisher. Format content for the target medium and write it to a file.`,
});

export default smithers((ctx) => {
  const outline = ctx.outputMaybe("outline", { nodeId: "outline" });
  const draft = ctx.outputMaybe("draft", { nodeId: "draft" });
  const edited = ctx.outputMaybe("edit", { nodeId: "edit" });

  return (
    <Workflow name="waterfall">
      <Sequence>
        <Task id="outline" output={outputs.outline} agent={outliner}>
          {`Create an outline for:
Topic: ${ctx.input.topic}
Audience: ${ctx.input.audience ?? "developers"}
Length: ${ctx.input.targetWords ?? 2000} words
${ctx.input.context ? `Context:\n${ctx.input.context}` : ""}`}
        </Task>

        <Task id="draft" output={outputs.draft} agent={drafter}>
          {`Write a draft following this outline:

${outline?.sections?.map((s) => `## ${s.title}\nKey points: ${s.keyPoints.join(", ")}\nTarget: ~${s.estimatedLength} words`).join("\n\n") ?? "Waiting for outline..."}

Target audience: ${outline?.targetAudience ?? ctx.input.audience ?? "developers"}`}
        </Task>

        <Task id="edit" output={outputs.edit} agent={editor}>
          {`Edit this draft for clarity, correctness, and flow:

${draft?.content ?? "Waiting for draft..."}

Focus on: readability, technical accuracy, conciseness.`}
        </Task>

        <Task id="publish" output={outputs.publish} agent={publisher}>
          {`Publish the edited content:

${edited?.content ?? "Waiting for edits..."}

Output file: ${ctx.input.outputFile ?? "output.md"}
Format: ${ctx.input.format ?? "markdown"}`}
        </Task>
      </Sequence>
    </Workflow>
  );
});
