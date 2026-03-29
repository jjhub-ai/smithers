/** @jsxImportSource smithers */
import { spawnSync } from "node:child_process";
import {
  createSmithers,
  PiAgent,
  Workflow,
  Task,
  Sequence,
  Ralph,
} from "smithers";
import { z } from "zod";

const DEFAULT_VALIDATION_COMMANDS = [
  "bun run typecheck",
  "bun run test",
];
const DEFAULT_PI_PROVIDER = "openai-codex";
const DEFAULT_PI_MODEL = "gpt-5.4";

const ImplementOutput = z.object({
  summary: z.string(),
  filesChanged: z.array(z.string()).default([]),
  notableDecisions: z.array(z.string()).default([]),
  remainingRisks: z.array(z.string()).default([]),
});

const ValidateOutput = z.object({
  allPassed: z.boolean(),
  summary: z.string(),
  gitStatus: z.string(),
  gitDiffStat: z.string(),
  results: z.array(
    z.object({
      command: z.string(),
      exitCode: z.number().int(),
      passed: z.boolean(),
      stdout: z.string(),
      stderr: z.string(),
    }),
  ),
});

const ReviewOutput = z.object({
  approved: z.boolean(),
  summary: z.string(),
  blockingFeedback: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
});

const FinalOutput = z.object({
  approved: z.boolean(),
  reviewRounds: z.number().int().min(1),
  implementationSummary: z.string(),
  validationSummary: z.string(),
  reviewSummary: z.string(),
  blockingFeedback: z.array(z.string()).default([]),
});

const { smithers, outputs } = createSmithers(
  {
    implement: ImplementOutput,
    validate: ValidateOutput,
    review: ReviewOutput,
    finalReport: FinalOutput,
  },
  {
    dbPath: "./workflows/agent-trace-otel-loop.db",
    journalMode: "DELETE",
  },
);

function createImplementerAgent(provider: string, model: string) {
  return new PiAgent({
    provider,
    model,
    mode: "rpc",
    yolo: true,
    timeoutMs: 45 * 60 * 1000,
    idleTimeoutMs: 5 * 60 * 1000,
    thinking: "high",
    appendSystemPrompt: [
      "You are the implementation agent for Smithers.",
      "Work directly in the current repository.",
      "Read the specification before changing code.",
      "You must make the smallest coherent set of changes that satisfies the specification.",
      "Do not claim verification you did not actually obtain.",
      "Return exact changed file paths and a concise risk summary.",
    ].join("\n"),
  });
}

function createReviewerAgent(provider: string, model: string) {
  return new PiAgent({
    provider,
    model,
    mode: "rpc",
    yolo: true,
    timeoutMs: 30 * 60 * 1000,
    idleTimeoutMs: 5 * 60 * 1000,
    thinking: "high",
    appendSystemPrompt: [
      "You are an extremely strict implementation reviewer.",
      "Your job is to reject weak, incomplete, under-verified, or cosmetically-correct changes.",
      "Be direct and unsentimental.",
      "Approve only if the implementation clearly satisfies the specification and the deterministic validation evidence is strong.",
      "If validation is weak, incomplete, or missing, that is blocking feedback.",
      "If logs/traces/verification claims are hand-wavy, that is blocking feedback.",
      "Prefer a short list of high-severity blocking issues over a long list of minor nits.",
    ].join("\n"),
  });
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function resolveValidationCommands(input: Record<string, unknown>): string[] {
  const commands = input.validationCommands;
  const parsed = asStringArray(commands);
  return parsed.length > 0 ? parsed : DEFAULT_VALIDATION_COMMANDS;
}

function runShell(command: string) {
  const result = spawnSync(command, {
    shell: true,
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    command,
    exitCode: result.status ?? (result.error ? 1 : 0),
    passed: (result.status ?? 0) === 0 && !result.error,
    stdout: (result.stdout ?? "").trim(),
    stderr: [result.stderr ?? "", result.error?.message ?? ""].filter(Boolean).join("\n").trim(),
  };
}

export default smithers((ctx) => {
  const latestImplement = ctx.latest("implement", "implement");
  const latestValidate = ctx.latest("validate", "validate");
  const latestReview = ctx.latest("review", "review");

  const approved = latestReview?.approved === true;
  const piProvider = asString(
    (ctx.input as Record<string, unknown>).piProvider,
    DEFAULT_PI_PROVIDER,
  );
  const piModel = asString(
    (ctx.input as Record<string, unknown>).piModel,
    DEFAULT_PI_MODEL,
  );
  const implementer = createImplementerAgent(piProvider, piModel);
  const reviewer = createReviewerAgent(piProvider, piModel);
  const validationCommands = resolveValidationCommands(ctx.input as Record<string, unknown>);
  const branchName = asString((ctx.input as Record<string, unknown>).branchName, "feat/agent-trace-otel-logs");
  const specPath = asString(
    (ctx.input as Record<string, unknown>).specPath,
    "docs/concepts/agent-trace-otel-logs-spec.mdx",
  );
  const composePath = asString(
    (ctx.input as Record<string, unknown>).composePath,
    "observability/docker-compose.otel.yml",
  );

  return (
    <Workflow name="agent-trace-otel-loop">
      <Sequence>
        <Ralph
          id="implement-review-loop"
          until={approved}
          maxIterations={5}
          onMaxReached="return-last"
        >
          <Sequence>
            <Task id="implement" output={outputs.implement} agent={implementer}>
              {`Read the spec first: ${specPath}. Treat it as the source of truth. The work is not “add some logs.” The work is:

1. define and implement a canonical agent trace model
2. capture the fullest observable trace per agent family
3. export those canonical trace events as OTEL logs
4. verify end-to-end in Docker with Loki
5. prove correctness using the verification section in the spec

Also note the current local stack in ${composePath} does not include Loki yet. It only starts collector, Prometheus, Tempo, and Grafana. Adding Loki and a collector logs pipeline is part of the assignment.

What He Should Understand Before Coding
Read these first:

- ${specPath}
- ${composePath}
- observability/otel-collector-config.yml
- docs/guides/monitoring-logs.mdx
- docs/runtime/events.mdx
- docs/integrations/pi-integration.mdx
- docs/integrations/cli-agents.mdx

Then inspect the code paths that matter:

- src/agents/PiAgent.ts
- src/agents/BaseCliAgent.ts
- src/events.ts
- src/effect/logging.ts
- src/observability/index.ts

Expected Deliverable
He should not stop at implementation. He should hand back:

- code
- updated Docker observability stack with Loki
- tests
- a reproducible verification procedure
- sample queries proving the system works

Required Verification Environment
He should use Docker for the local stack:

smithers observability --detach

That CLI currently starts the stack from src/cli/index.ts:876, but he will need to extend it so the stack includes Loki too.

Target local endpoints after his changes should be something like:

- Grafana
- Prometheus
- Tempo
- Loki
- OTEL collector

He should document exact ports if he changes them.

How He Should Verify
Use the spec’s verification classes as the acceptance gate. In practice, he should prove all of this:

1. Canonical trace capture works
   Run a workflow with at least one agent that has a rich trace surface, preferably PiAgent.
   He must show:
   - assistant text deltas
   - visible thinking deltas if Pi emits them
   - tool execution start/update/end
   - final assistant message
   - run/node/attempt correlation fields
2. OTEL logs are really exported
   Not just local files. He must prove the canonical trace events land in Loki or another OTEL log backend through the collector.
3. Logs are queryable
   In Grafana/Loki he must show queries that answer:
   - all events for one run.id
   - one node.id + attempt
   - only assistant.thinking.delta
   - only tool.execution.*
   - only capture.error
4. Current metrics/traces still work
   He must ensure adding logs does not break existing Prometheus/Tempo behavior.
5. Failure cases are classified
   He should simulate at least:
   - malformed upstream JSON
   - collector unavailable
   - subprocess exits early
   - redaction case
   and show the system reports capture.error, partial-observed, or capture-failed correctly.
6. Redaction works
   He must include at least one fixture with a secret-like token and show it is absent from:
   - canonical persisted payload
   - OTEL log body
   - artifacts if artifacts are enabled

Recommended Test Matrix
Tell him to verify at least this matrix:

- PiAgent:
    - rich trace success case
    - failure case
    - redaction case
- one structured CLI agent:
    - CodexAgent or ClaudeCodeAgent
    - prove structured events are preserved if available
    - otherwise prove truthful partial classification
- one SDK agent:
    - OpenAIAgent or AnthropicAgent
    - prove partial/final-only capture is explicit, not faked

Suggested Demo Workflow
He should create or reuse one simple workflow specifically for observability verification:

- one task using PiAgent
- one task using a second agent family
- at least one tool invocation
- stable run annotations
- easy-to-query workflow path

Then run it with OTEL enabled, for example:

export SMITHERS_OTEL_ENABLED=1
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=smithers-dev

What “Done” Means
Use this language with him:

Done means:

- Loki is part of the local Docker stack
- the collector has a real logs pipeline
- canonical agent trace events exist
- at least Pi is high-fidelity per spec
- other agent families are truthfully classified
- there are automated tests for schema, ordering, fidelity, completeness, export, redaction, and failure handling
- there is a written verification section with commands and Grafana/Loki queries
- a reviewer can reproduce the verification from a clean checkout

What He Should Return
Ask him to return:

- the branch
- a short “verification report” with:
    - commands run
    - workflow used
    - exact Grafana/Loki queries
    - screenshots or copied query results
    - which verification classes from the spec passed
    - any explicitly deferred items

Execution context:
- branch: ${branchName}
- PI provider/model: ${piProvider}/${piModel}
${latestReview ? `- Previous review summary: ${latestReview.summary}` : "- This is the first implementation pass."}
${latestReview?.blockingFeedback?.length ? `- Blocking feedback to address:\n${latestReview.blockingFeedback.map((item: string) => `  - ${item}`).join("\n")}` : ""}
${latestValidate ? `- Latest deterministic validation summary: ${latestValidate.summary}` : "- No deterministic validation results exist yet."}

Return JSON only, with:
- summary
- filesChanged
- notableDecisions
- remainingRisks`}
            </Task>

            <Task id="validate" output={outputs.validate}>
              {() => {
                const results = validationCommands.map(runShell);
                const allPassed = results.every((result) => result.passed);
                const gitStatus = runShell("git status --short").stdout;
                const gitDiffStat = runShell("git diff --stat").stdout;
                const failed = results.filter((result) => !result.passed);

                return {
                  allPassed,
                  summary: allPassed
                    ? `All deterministic validation commands passed (${results.length} commands).`
                    : `${failed.length} of ${results.length} deterministic validation commands failed.`,
                  gitStatus,
                  gitDiffStat,
                  results,
                };
              }}
            </Task>

            <Task id="review" output={outputs.review} agent={reviewer}>
              {`Review the implementation brutally.

This is a Smithers implementation-review loop for the OTEL agent trace logging work.

Primary brief files:
- ${specPath}
- ${composePath}
- PI provider/model under review: ${piProvider}/${piModel}

You are reviewing the current repository state, not an abstract plan.

Implementation agent report:
${latestImplement ? JSON.stringify(latestImplement, null, 2) : "No implementation report was produced."}

Deterministic validation report:
${latestValidate ? JSON.stringify(latestValidate, null, 2) : "No validation report was produced."}

Your role:
- You are the backpressure mechanism.
- You are not a collaborator helping the implementer feel good.
- You are the reviewer responsible for preventing weak, premature, under-verified changes from passing.
- You must assume the implementer will take shortcuts unless the evidence proves otherwise.

Verification duties:
- Audit whether the implementation actually satisfies the verification section of the spec.
- Require evidence, not intent.
- Treat missing end-to-end verification as a blocking failure.
- Treat unverified Docker + Loki + collector integration as a blocking failure.
- Treat absent or weak query examples as a blocking failure.
- Treat missing failure-mode validation as a blocking failure.
- Treat redaction claims without proof as a blocking failure.
- Treat “it should work” or “it is wired” language as evidence of incompleteness.

Smithers coding-style duties:
- Enforce repository-local conventions over generic agent habits.
- Reject unnecessary abstraction, speculative generalization, and architecture without pressure.
- Reject code that hides truthfulness about agent fidelity.
- Reject code that collapses raw event boundaries into summaries when the spec requires preservation.
- Reject code that uses high-cardinality labels for large bodies.
- Reject implementation that weakens durable local truth in favor of OTEL-only export.
- Reject code that does not fit the existing Smithers runtime, observability, and event model cleanly.
- Reject hand-wavy docs that are not reproducible from a clean checkout.

Specific rejection criteria:
- Reject any vague or partial implementation.
- Reject if the OTEL logs path is not actually verifiable with Docker + Loki + Grafana.
- Reject if Pi trace capture is not clearly higher fidelity than the other agents.
- Reject if unsupported agent capabilities are hand-waved instead of truthfully classified.
- Reject if deterministic validation is weak, missing, or ignored.
- Reject if the work appears to optimize appearance over correctness.
- Reject if tests cover only the happy path.
- Reject if the coworker handoff is missing commands, queries, or exact verification steps.

Approval standard:
- Approve only if the implementation appears specification-complete, verification-complete, reproducible, and operationally believable.
- If there is any meaningful unresolved risk, set approved=false.
- Default to rejection unless the evidence is boringly strong.

Feedback style:
- Be harsh, concise, and specific.
- Prioritize the highest-severity blockers.
- Do not soften critique.
- Do not pad with praise unless it is genuinely earned and still useful.

Return JSON only, with:
- approved
- summary
- blockingFeedback
- strengths
- nextActions`}
            </Task>
          </Sequence>
        </Ralph>

        <Task id="final-report" output={outputs.finalReport}>
          {() => ({
            approved: latestReview?.approved === true,
            reviewRounds: ctx.iterationCount("review", "review"),
            implementationSummary: latestImplement?.summary ?? "No implementation summary available.",
            validationSummary: latestValidate?.summary ?? "No validation summary available.",
            reviewSummary: latestReview?.summary ?? "No review summary available.",
            blockingFeedback: latestReview?.blockingFeedback ?? [],
          })}
        </Task>
      </Sequence>
    </Workflow>
  );
});
