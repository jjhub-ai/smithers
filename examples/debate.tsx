/**
 * <Debate> — Two agents argue opposing positions, a judge decides.
 *
 * Pattern: Proposer argues for → Opponent argues against → Judge synthesizes.
 * Use cases: design decisions, architecture choices, trade-off analysis,
 * RFC evaluation, technology selection.
 */
import { createSmithers, Sequence, Parallel, Loop } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

const argumentSchema = z.object({
  position: z.enum(["for", "against"]),
  round: z.number(),
  points: z.array(z.object({
    claim: z.string(),
    evidence: z.string(),
    strength: z.enum(["strong", "moderate", "weak"]),
  })),
  rebuttals: z.array(z.string()),
  summary: z.string(),
});

const verdictSchema = z.object({
  decision: z.string(),
  winner: z.enum(["for", "against", "draw"]),
  reasoning: z.string(),
  conditions: z.array(z.string()),
  risks: z.array(z.string()),
  recommendation: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  argument: argumentSchema,
  verdict: verdictSchema,
});

const proposer = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep },
  instructions: `You argue FOR the proposed approach. Find evidence in the codebase.
Build strong arguments. Rebut the opponent's points with specifics.`,
});

const opponent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep },
  instructions: `You argue AGAINST the proposed approach. Find counter-evidence.
Identify risks, costs, and alternatives. Rebut the proposer's points.`,
});

const judge = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep },
  instructions: `You are an impartial judge. Weigh both sides' arguments based on
evidence quality, not rhetoric. Make a clear decision with conditions and risk mitigation.`,
});

export default smithers((ctx) => {
  const args = ctx.outputs.argument ?? [];
  const rounds = ctx.input.rounds ?? 2;
  const currentRound = Math.floor(args.length / 2) + 1;
  const debateComplete = currentRound > rounds;

  const forArgs = args.filter((a) => a.position === "for");
  const againstArgs = args.filter((a) => a.position === "against");

  return (
    <Workflow name="debate">
      <Sequence>
        <Loop until={debateComplete} maxIterations={rounds}>
          <Sequence>
            {/* Both sides argue simultaneously */}
            <Parallel>
              <Task id={`for-round-${currentRound}`} output={outputs.argument} agent={proposer}>
                {`Round ${currentRound}/${rounds} — Argue FOR:

Question: ${ctx.input.question}
Context: ${ctx.input.context ?? ""}
Directory: ${ctx.input.directory ?? "."}

${againstArgs.length > 0 ? `Opponent's latest arguments to rebut:\n${againstArgs[againstArgs.length - 1].points.map((p) => `- ${p.claim}: ${p.evidence}`).join("\n")}` : "This is the opening round. Make your strongest case."}`}
              </Task>

              <Task id={`against-round-${currentRound}`} output={outputs.argument} agent={opponent}>
                {`Round ${currentRound}/${rounds} — Argue AGAINST:

Question: ${ctx.input.question}
Context: ${ctx.input.context ?? ""}
Directory: ${ctx.input.directory ?? "."}

${forArgs.length > 0 ? `Proposer's latest arguments to rebut:\n${forArgs[forArgs.length - 1].points.map((p) => `- ${p.claim}: ${p.evidence}`).join("\n")}` : "This is the opening round. Make your strongest counter-case."}`}
              </Task>
            </Parallel>
          </Sequence>
        </Loop>

        {/* Judge renders verdict */}
        <Task id="verdict" output={outputs.verdict} agent={judge}>
          {`Judge this debate on: "${ctx.input.question}"

FOR arguments (${forArgs.length} rounds):
${forArgs.map((a) => `Round ${a.round}: ${a.summary}`).join("\n")}

AGAINST arguments (${againstArgs.length} rounds):
${againstArgs.map((a) => `Round ${a.round}: ${a.summary}`).join("\n")}

Render a clear verdict with reasoning, conditions, and risk mitigation.`}
        </Task>
      </Sequence>
    </Workflow>
  );
});
