// smithers-source: seeded
/** @jsxImportSource smithers-orchestrator */
import { Sequence, Loop, Task, type AgentLike } from "smithers-orchestrator";
import { z } from "zod/v4";
import ImplementPrompt from "../prompts/implement.mdx";
import ValidatePrompt from "../prompts/validate.mdx";
import { Review, reviewOutputSchema } from "./Review";

export const implementOutputSchema = z.object({
  summary: z.string(),
  filesChanged: z.array(z.string()).default([]),
  allTestsPassing: z.boolean().default(true),
});

export const validateOutputSchema = z.object({
  summary: z.string(),
  allPassed: z.boolean().default(true),
  failingSummary: z.string().nullable().default(null),
});

type ValidationLoopProps = {
  idPrefix: string;
  prompt: unknown;
  implementAgents: AgentLike[];
  reviewAgents: AgentLike[];
  validateAgents?: AgentLike[];
  /** Prior validation/review feedback to incorporate (set by parent on re-render). */
  feedback?: string | null;
  /** Whether the loop is done (validation passed AND review approved). */
  done?: boolean;
  /** Max iterations before giving up. Defaults to 3. */
  maxIterations?: number;
};

export function ValidationLoop({
  idPrefix,
  prompt,
  implementAgents,
  reviewAgents,
  validateAgents,
  feedback,
  done = false,
  maxIterations = 3,
}: ValidationLoopProps) {
  const validationChain = validateAgents && validateAgents.length > 0
    ? validateAgents
    : implementAgents;
  const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);

  const implementPrompt = feedback
    ? `${promptText}\n\n---\nPREVIOUS ATTEMPT FEEDBACK (fix these issues):\n${feedback}`
    : promptText;

  return (
    <Loop id={`${idPrefix}:loop`} until={done} maxIterations={maxIterations} onMaxReached="return-last">
      <Sequence>
        <Task id={`${idPrefix}:implement`} output={implementOutputSchema} agent={implementAgents} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
          <ImplementPrompt prompt={implementPrompt} />
        </Task>
        <Task id={`${idPrefix}:validate`} output={validateOutputSchema} agent={validationChain} timeoutMs={1_800_000} heartbeatTimeoutMs={600_000}>
          <ValidatePrompt prompt={promptText} />
        </Task>
        <Review idPrefix={`${idPrefix}:review`} prompt={promptText} agents={reviewAgents} />
      </Sequence>
    </Loop>
  );
}
