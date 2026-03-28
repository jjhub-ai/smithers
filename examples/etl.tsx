/**
 * <ETL> — Extract → Transform → Load pipeline with per-stage agents.
 *
 * Pattern: Extract data from source → Transform/enrich with agent → Load to destination.
 * Use cases: data migration, API sync, content processing, log analysis.
 */
import { createSmithers, Sequence } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, write, bash, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

const extractSchema = z.object({
  records: z.array(z.object({
    id: z.string(),
    raw: z.string(),
    source: z.string(),
  })),
  totalExtracted: z.number(),
});

const transformSchema = z.object({
  records: z.array(z.object({
    id: z.string(),
    transformed: z.string(),
    metadata: z.record(z.string()),
  })),
  totalTransformed: z.number(),
  errors: z.array(z.string()),
});

const loadSchema = z.object({
  totalLoaded: z.number(),
  destination: z.string(),
  errors: z.array(z.string()),
  summary: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  extract: extractSchema,
  transform: transformSchema,
  load: loadSchema,
});

const extractor = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, bash, grep },
  instructions: `You are a data extractor. Read data from the specified source and output
structured records. Handle encoding issues, pagination, and partial failures gracefully.`,
});

const transformer = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  instructions: `You are a data transformer. Apply the specified transformations to each record.
Enrich with metadata, normalize formats, and flag any records that can't be processed.`,
});

const loader = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { write, bash },
  instructions: `You are a data loader. Write the transformed records to the specified destination.
Handle conflicts, deduplication, and report any failures.`,
});

export default smithers((ctx) => {
  const extracted = ctx.outputMaybe("extract", { nodeId: "extract" });
  const transformed = ctx.outputMaybe("transform", { nodeId: "transform" });

  return (
    <Workflow name="etl">
      <Sequence>
        <Task id="extract" output={outputs.extract} agent={extractor}>
          {`Extract data from: ${ctx.input.source}
Pattern: ${ctx.input.pattern ?? "*"}
Format: ${ctx.input.sourceFormat ?? "auto-detect"}`}
        </Task>

        <Task id="transform" output={outputs.transform} agent={transformer}>
          {`Transform these ${extracted?.totalExtracted ?? 0} records:

${JSON.stringify(extracted?.records?.slice(0, 5) ?? [])}
${(extracted?.totalExtracted ?? 0) > 5 ? `... and ${(extracted?.totalExtracted ?? 0) - 5} more` : ""}

Transformation rules:
${ctx.input.transformRules ?? "Normalize and clean the data"}

Output format: ${ctx.input.targetFormat ?? "JSON"}`}
        </Task>

        <Task id="load" output={outputs.load} agent={loader}>
          {`Load ${transformed?.totalTransformed ?? 0} transformed records to: ${ctx.input.destination}

Records:
${JSON.stringify(transformed?.records?.slice(0, 5) ?? [])}
${(transformed?.totalTransformed ?? 0) > 5 ? `... and ${(transformed?.totalTransformed ?? 0) - 5} more` : ""}

Handle duplicates: ${ctx.input.onDuplicate ?? "skip"}`}
        </Task>
      </Sequence>
    </Workflow>
  );
});
