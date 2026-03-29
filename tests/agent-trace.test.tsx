/** @jsxImportSource smithers */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workflow, Task, runWorkflow } from "../src";
import {
  AgentTraceCollector,
  agentSessionEventToOtelLogRecord,
  canonicalTraceEventToOtelLogRecord,
  detectAgentFamily,
  detectCaptureMode,
} from "../src/agent-trace";
import { SmithersDb } from "../src/db/adapter";
import { runPromise } from "../src/effect/runtime";
import {
  logToolCallEffect,
  logToolCallStartEffect,
} from "../src/tools/logToolCall";
import { createTestSmithers } from "./helpers";
import { z } from "zod";

async function listRunEvents(db: any, runId: string) {
  const adapter = new SmithersDb(db as any);
  return adapter.listEvents(runId, -1, 500);
}

describe("agent trace capture", () => {
  test("captures high-fidelity Pi canonical trace events with ordering and redaction", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-pi";

    const piLikeAgent: any = {
      id: "pi-agent-test",
      opts: { mode: "json" },
      generate: async (args: { onStdout?: (text: string) => void }) => {
        args.onStdout?.(
          JSON.stringify({ type: "session", id: "sess-1" }) + "\n",
        );
        args.onStdout?.(JSON.stringify({ type: "turn_start" }) + "\n");
        args.onStdout?.(
          JSON.stringify({
            type: "message_start",
            message: { role: "assistant", content: [] },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "message_update",
            assistantMessageEvent: {
              type: "thinking_delta",
              delta: "thinking secret=sk_abc123456789",
            },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "hello" },
          }) + "\n",
        );
        const startedCall = await runPromise(logToolCallStartEffect("bash"));
        await runPromise(
          logToolCallEffect(
            "bash",
            { cmd: "echo secret=sk_live_123456789" },
            { ok: true },
            "success",
            undefined,
            undefined,
            startedCall?.seq,
            startedCall?.toolCallId,
          ),
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_execution_start",
            toolExecution: { id: "t1", name: "bash", args: { cmd: "echo hi" } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_execution_end",
            toolExecution: { id: "t1", name: "bash", result: { ok: true } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Final answer" }],
              stopReason: "stop",
            },
          }) + "\n",
        );
        args.onStdout?.(JSON.stringify({ type: "agent_end" }) + "\n");
        return {
          text: '{"answer":"Final answer"}',
          output: { answer: "Final answer" },
        };
      },
    };

    const workflow = smithers(() => (
      <Workflow name="pi-trace">
        <Task id="task" output={outputs.result} agent={piLikeAgent}>
          do the thing
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, {
      input: {},
      runId,
      workflowPath: "/tmp/pi-trace.tsx",
      annotations: { "custom.demo": true, ticket: 123 },
    });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const artifactEvent = traceEvents.find(
      (event: any) => event.event.kind === "artifact.created",
    );
    const persistedRows = readFileSync(
      artifactEvent?.payload?.artifactPath,
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(summary.agentFamily).toBe("pi");
    expect(summary.captureMode).toBe("cli-json-stream");
    expect(summary.traceCompleteness).toBe("full-observed");

    const kinds = traceEvents.map((event: any) => event.event.kind);
    expect(kinds).toContain("session.start");
    expect(kinds).toContain("turn.start");
    expect(kinds).toContain("assistant.thinking.delta");
    expect(kinds).toContain("assistant.text.delta");
    expect(kinds).toContain("tool.execution.start");
    expect(kinds).toContain("tool.execution.end");
    expect(kinds).toContain("assistant.message.final");

    const sequences = traceEvents.map((event: any) => event.event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(
      traceEvents.filter(
        (event: any) => event.event.kind === "tool.execution.start",
      ),
    ).toHaveLength(1);
    expect(
      traceEvents.filter(
        (event: any) => event.event.kind === "tool.execution.end",
      ),
    ).toHaveLength(1);
    expect(
      persistedRows
        .filter((row: any) => "event" in row)
        .every((row: any) => row.traceCompleteness === "full-observed"),
    ).toBe(true);
    expect(persistedRows.at(-1)?.summary?.traceCompleteness).toBe(
      "full-observed",
    );

    const redacted = JSON.stringify(traceEvents);
    expect(redacted).not.toContain("sk_abc123456789");
    expect(redacted).not.toContain("sk_live_123456789");
    expect(traceEvents.some((event: any) => event.redaction.applied)).toBe(
      true,
    );
    expect(
      traceEvents.every(
        (event: any) => event.annotations["custom.demo"] === true,
      ),
    ).toBe(true);

    cleanup();
  });

  test("classifies malformed Pi JSON as capture-failed", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-pi-fail";

    const piLikeAgent: any = {
      id: "pi-agent-failure",
      opts: { mode: "json" },
      generate: async (args: { onStdout?: (text: string) => void }) => {
        args.onStdout?.("{not json}\n");
        throw new Error("subprocess exits early");
      },
    };

    const workflow = smithers(() => (
      <Workflow name="pi-trace-fail">
        <Task id="task" output={outputs.result} agent={piLikeAgent} retries={0}>
          fail please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("failed");

    const events = await listRunEvents(db, runId);
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;

    expect(summary.traceCompleteness).toBe("capture-failed");
    expect(
      traceEvents.some((event: any) => event.event.kind === "capture.error"),
    ).toBe(true);

    cleanup();
  });

  test("preserves Pi message.update fallback and tool updates from one transcript", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-pi-update-fallback";

    const piLikeAgent: any = {
      id: "pi-agent-update-fallback",
      opts: { mode: "json" },
      generate: async (args: { onStdout?: (text: string) => void }) => {
        args.onStdout?.(JSON.stringify({ type: "session", id: "sess-2" }) + "\n");
        args.onStdout?.(
          JSON.stringify({
            type: "message_update",
            message: { role: "assistant", content: [{ type: "text", text: "partial state" }] },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_execution_update",
            toolExecution: { id: "tool-2", name: "bash", result: { status: "running" } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Pi final update" }],
            },
          }) + "\n",
        );
        args.onStdout?.(JSON.stringify({ type: "agent_end" }) + "\n");
        return {
          text: '{"answer":"Pi final update"}',
          output: { answer: "Pi final update" },
        };
      },
    };

    const workflow = smithers(() => (
      <Workflow name="pi-update-fallback">
        <Task id="task" output={outputs.result} agent={piLikeAgent}>
          pi update fallback please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "message.update" &&
          event.payload.text === "partial state",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "tool.execution.update" &&
          event.payload.toolCallId === "tool-2",
      ),
    ).toBe(true);

    cleanup();
  });

  test("truthfully classifies sdk agents as final-only", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-sdk";

    class OpenAIAgentFake {
      id = "openai-sdk-fake";
      tools = {};
      async generate() {
        return {
          text: '{"answer":"sdk final"}',
          output: { answer: "sdk final" },
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="sdk-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new OpenAIAgentFake() as any}
        >
          sdk final only
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.agentFamily).toBe("openai");
    expect(summary.captureMode).toBe("sdk-events");
    expect(summary.traceCompleteness).toBe("final-only");
    expect(summary.unsupportedEventKinds).toContain("assistant.thinking.delta");
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "assistant.message.final",
      ),
    ).toBe(true);
    expect(traceEvents.some((event: any) => event.event.kind === "usage")).toBe(
      true,
    );
    const finalMessage = traceEvents.find(
      (event: any) => event.event.kind === "assistant.message.final",
    );
    const usage = traceEvents.find((event: any) => event.event.kind === "usage");
    expect(finalMessage?.source.rawEventId).toBeTruthy();
    expect(finalMessage?.source.rawEventId).toBe(usage?.source.rawEventId);

    cleanup();
  });

  test("preserves structured Claude stream-json deltas truthfully", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-claude-structured";

    class ClaudeCodeAgentFake {
      id = "claude-code-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "message_start",
            message: { role: "assistant" },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "message_delta",
            delta: { text: "claude delta" },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "message_end",
            message: { role: "assistant", content: "claude final" },
            usage: { input_tokens: 4, output_tokens: 2 },
          }) + "\n",
        );
        return {
          text: '{"answer":"claude final"}',
          output: { answer: "claude final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="claude-structured-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new ClaudeCodeAgentFake() as any}
        >
          structured claude please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.agentFamily).toBe("claude-code");
    expect(summary.captureMode).toBe("cli-json-stream");
    expect(summary.traceCompleteness).toBe("full-observed");
    expect(
      traceEvents.some((event: any) => event.event.kind === "message.start"),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.text.delta" &&
          event.payload.text === "claude delta",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "assistant.message.final",
      ),
    ).toBe(true);
    expect(traceEvents.some((event: any) => event.event.kind === "usage")).toBe(
      true,
    );
    cleanup();
  });

  test("normalizes real Claude stream-json assistant/result events", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-claude-real-schema";

    class ClaudeCodeAgentRealSchemaFake {
      id = "claude-code-real-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "system",
            subtype: "init",
            session_id: "sess-1",
            model: "claude-opus-4-6[1m]",
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "claude real final" }],
              usage: {
                input_tokens: 3,
                cache_read_input_tokens: 4,
                output_tokens: 2,
              },
            },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "result",
            subtype: "success",
            result: "claude real final",
            usage: {
              input_tokens: 3,
              cache_read_input_tokens: 4,
              output_tokens: 20,
            },
          }) + "\n",
        );
        return {
          text: '{"answer":"claude real final"}',
          output: { answer: "claude real final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="claude-real-schema-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new ClaudeCodeAgentRealSchemaFake() as any}
        >
          structured claude real schema please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.traceCompleteness).toBe("full-observed");
    expect(summary.unsupportedEventKinds).not.toContain("artifact.created");
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "message.update" &&
          event.payload.text === "claude real final",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.text.delta" &&
          event.payload.text === "claude real final",
      ),
    ).toBe(false);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.message.final" &&
          event.payload.text === "claude real final",
      ),
    ).toBe(true);
    expect(traceEvents.filter((event: any) => event.event.kind === "usage").length).toBe(2);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "usage" &&
          event.payload.outputTokens === 20,
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.message.final" &&
          event.source.observed === false &&
          event.source.rawType === "result",
      ),
    ).toBe(true);
    const assistantUpdate = traceEvents.find(
      (event: any) =>
        event.event.kind === "message.update" &&
        event.source.rawType === "assistant",
    );
    const assistantUsage = traceEvents.find(
      (event: any) =>
        event.event.kind === "usage" &&
        event.source.rawType === "assistant",
    );
    expect(assistantUpdate?.source.rawEventId).toBeTruthy();
    expect(assistantUpdate?.source.rawEventId).toBe(
      assistantUsage?.source.rawEventId,
    );

    cleanup();
  });

  test("preserves Claude structured tool lifecycle with shared raw event ids", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-claude-tool-lifecycle";

    class ClaudeToolLifecycleFake {
      id = "claude-tool-lifecycle-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "tool_call.started",
            toolCall: { id: "tool-claude-1", name: "read", args: { path: "README.md" } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_call.completed",
            toolCall: { id: "tool-claude-1", name: "read", result: { ok: true } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "message_end",
            message: { role: "assistant", content: "claude tool final" },
          }) + "\n",
        );
        return {
          text: '{"answer":"claude tool final"}',
          output: { answer: "claude tool final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="claude-tool-lifecycle-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new ClaudeToolLifecycleFake() as any}
        >
          structured claude tool lifecycle please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    const toolStart = traceEvents.find(
      (event: any) => event.event.kind === "tool.execution.start",
    );
    const toolEnd = traceEvents.find(
      (event: any) => event.event.kind === "tool.execution.end",
    );

    expect(toolStart?.payload.toolCallId).toBe("tool-claude-1");
    expect(toolEnd?.payload.toolCallId).toBe("tool-claude-1");
    expect(toolStart?.source.rawEventId).not.toBe(toolEnd?.source.rawEventId);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.message.final" &&
          event.payload.text === "claude tool final",
      ),
    ).toBe(true);

    cleanup();
  });

  test("preserves structured Codex completion usage and final message truthfully", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-codex-structured";

    class CodexAgentFake {
      id = "codex-fake";
      opts = { outputFormat: "stream-json", json: true };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "assistant_message.delta",
            delta: { text: "codex delta" },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 8, output_tokens: 3 },
            message: { role: "assistant", content: "codex final" },
          }) + "\n",
        );
        return {
          text: '{"answer":"codex final"}',
          output: { answer: "codex final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="codex-structured-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new CodexAgentFake() as any}
        >
          structured codex please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.agentFamily).toBe("codex");
    expect(summary.captureMode).toBe("cli-json-stream");
    expect(summary.traceCompleteness).toBe("full-observed");
    expect(summary.unsupportedEventKinds).not.toContain("artifact.created");
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.text.delta" &&
          event.payload.text === "codex delta",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "assistant.message.final",
      ),
    ).toBe(true);
    expect(traceEvents.some((event: any) => event.event.kind === "usage")).toBe(
      true,
    );
    expect(summary.unsupportedEventKinds).not.toContain("assistant.text.delta");
    const turnUsage = traceEvents.find(
      (event: any) => event.event.kind === "usage",
    );
    const turnEnd = traceEvents.find(
      (event: any) => event.event.kind === "turn.end",
    );
    const finalMessage = traceEvents.find(
      (event: any) => event.event.kind === "assistant.message.final",
    );
    expect(turnUsage?.source.rawEventId).toBeTruthy();
    expect(turnUsage?.source.rawEventId).toBe(turnEnd?.source.rawEventId);
    expect(turnUsage?.source.rawEventId).toBe(finalMessage?.source.rawEventId);
    cleanup();
  });

  test("treats Codex turn.completed without usage as a terminal structured event", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-codex-turn-completed-no-usage";

    class CodexNoUsageAgentFake {
      id = "codex-no-usage-fake";
      opts = { outputFormat: "stream-json", json: true };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "turn.started",
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn.completed",
            message: { role: "assistant", content: "codex final without usage" },
          }) + "\n",
        );
        return {
          text: '{"answer":"codex final without usage"}',
          output: { answer: "codex final without usage" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="codex-no-usage-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new CodexNoUsageAgentFake() as any}
        >
          codex without usage please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.traceCompleteness).toBe("full-observed");
    expect(
      traceEvents.some((event: any) => event.event.kind === "turn.end"),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.message.final" &&
          event.payload.text === "codex final without usage",
      ),
    ).toBe(true);

    cleanup();
  });

  test("preserves Codex structured tool lifecycle from one transcript", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-codex-tool-lifecycle";

    class CodexToolLifecycleFake {
      id = "codex-tool-lifecycle-fake";
      opts = { outputFormat: "stream-json", json: true };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "tool_call.started",
            toolCall: { id: "codex-tool-1", name: "grep", args: { pattern: "trace" } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_call.delta",
            toolCall: { id: "codex-tool-1", name: "grep", result: { status: "running" } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_call.completed",
            toolCall: { id: "codex-tool-1", name: "grep", result: { ok: true } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn.completed",
            message: { role: "assistant", content: "codex tool final" },
          }) + "\n",
        );
        return {
          text: '{"answer":"codex tool final"}',
          output: { answer: "codex tool final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="codex-tool-lifecycle-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new CodexToolLifecycleFake() as any}
        >
          codex tool lifecycle please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "tool.execution.start" &&
          event.payload.toolCallId === "codex-tool-1",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "tool.execution.update" &&
          event.payload.toolCallId === "codex-tool-1",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "tool.execution.end" &&
          event.payload.toolCallId === "codex-tool-1",
      ),
    ).toBe(true);

    cleanup();
  });

  test("captures real Codex dotted jsonl events as structured trace instead of cli-text fallback", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-codex-dotted-jsonl";

    class CodexJsonlAgentFake {
      readonly id = "codex-jsonl-fake";
      readonly opts = { outputFormat: "stream-json" as const, json: true };
      readonly family = "codex";

      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "thread.started",
            thread_id: "thread-1",
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn.started",
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "item-1",
              type: "agent_message",
              text: "Codex dotted final",
            },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn.completed",
            usage: {
              input_tokens: 10,
              cached_input_tokens: 2,
              output_tokens: 4,
            },
          }) + "\n",
        );
        return {
          text: '{"answer":"Codex dotted final"}',
          output: { answer: "Codex dotted final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="codex-dotted-jsonl-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new CodexJsonlAgentFake() as any}
        >
          structured codex dotted jsonl please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.captureMode).toBe("cli-json-stream");
    expect(summary.traceCompleteness).toBe("full-observed");
    expect(
      traceEvents.some((event: any) => event.event.kind === "turn.start"),
    ).toBe(true);
    expect(
      traceEvents.some((event: any) => event.event.kind === "turn.end"),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.message.final" &&
          event.source.observed === false &&
          event.payload.text === "Codex dotted final",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "usage" &&
          event.payload.inputTokens === 10 &&
          event.payload.cacheReadTokens === 2 &&
          event.payload.outputTokens === 4,
      ),
    ).toBe(true);

    cleanup();
  });

  test("classifies structured Gemini stream-json traces truthfully", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-gemini-structured";

    class GeminiAgentFake {
      id = "gemini-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "response.output_text.delta",
            delta: { text: "gemini delta" },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "response.completed",
            response: {
              role: "assistant",
              content: [{ text: "gemini final" }],
            },
            usage: { input_tokens: 6, output_tokens: 4 },
          }) + "\n",
        );
        return {
          text: '{"answer":"gemini final"}',
          output: { answer: "gemini final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="gemini-structured-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new GeminiAgentFake() as any}
        >
          structured gemini please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.agentFamily).toBe("gemini");
    expect(summary.captureMode).toBe("cli-json-stream");
    expect(summary.traceCompleteness).toBe("full-observed");
    expect(summary.unsupportedEventKinds).not.toContain("assistant.text.delta");
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.text.delta" &&
          event.payload.text === "gemini delta",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "assistant.message.final",
      ),
    ).toBe(true);

    cleanup();
  });

  test("normalizes real Gemini stream-json message/result events", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-gemini-real-schema";

    class GeminiAgentRealSchemaFake {
      id = "gemini-real-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "init",
            session_id: "sess-1",
            model: "gemini-3-flash-preview",
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content: "gemini ",
            delta: true,
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content: "real final",
            delta: true,
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "result",
            status: "success",
            stats: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
          }) + "\n",
        );
        return {
          text: '{"answer":"gemini real final"}',
          output: { answer: "gemini real final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="gemini-real-schema-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new GeminiAgentRealSchemaFake() as any}
        >
          structured gemini real schema please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.traceCompleteness).toBe("partial-observed");
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.text.delta" &&
          event.payload.text === "gemini ",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.text.delta" &&
          event.payload.text === "real final",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.message.final" &&
          event.payload.text === "gemini real final",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.message.final" &&
          event.source.observed === false,
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "usage" &&
          event.payload.inputTokens === 10 &&
          event.payload.outputTokens === 5,
      ),
    ).toBe(true);

    cleanup();
  });

  test("classifies Gemini cli-json coarse output as final-only", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-gemini-final-only";

    class GeminiAgentJsonFake {
      id = "gemini-json-fake";
      opts = { outputFormat: "json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            text: "gemini coarse final",
            stats: { models: { gemini: { tokens: { input: 3, output: 2 } } } },
          }) + "\n",
        );
        return {
          text: '{"answer":"gemini coarse final"}',
          output: { answer: "gemini coarse final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="gemini-final-only-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new GeminiAgentJsonFake() as any}
        >
          coarse gemini please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.agentFamily).toBe("gemini");
    expect(summary.captureMode).toBe("cli-json");
    expect(summary.traceCompleteness).toBe("final-only");
    expect(summary.unsupportedEventKinds).toContain("assistant.text.delta");
    expect(
      traceEvents.some((event: any) => event.event.kind === "usage"),
    ).toBe(false);

    cleanup();
  });

  test("preserves structured Kimi stream-json tool lifecycle truthfully", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-kimi-structured";

    class KimiAgentFake {
      id = "kimi-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "assistant_message.delta",
            delta: { text: "kimi delta" },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_execution_start",
            toolExecution: {
              id: "tool-1",
              name: "bash",
              args: { cmd: "echo hi" },
            },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_execution_update",
            toolExecution: {
              id: "tool-1",
              name: "bash",
              result: { status: "running" },
            },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "tool_execution_end",
            toolExecution: { id: "tool-1", name: "bash", result: { ok: true } },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "response.completed",
            response: { role: "assistant", content: [{ text: "kimi final" }] },
          }) + "\n",
        );
        return {
          text: '{"answer":"kimi final"}',
          output: { answer: "kimi final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="kimi-structured-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new KimiAgentFake() as any}
        >
          structured kimi please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.agentFamily).toBe("kimi");
    expect(summary.captureMode).toBe("cli-json-stream");
    expect(summary.traceCompleteness).toBe("full-observed");
    expect(summary.unsupportedEventKinds).not.toContain("tool.execution.start");
    expect(summary.unsupportedEventKinds).not.toContain("tool.execution.update");
    expect(summary.unsupportedEventKinds).not.toContain("tool.execution.end");
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "assistant.text.delta" &&
          event.payload.text === "kimi delta",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "tool.execution.start" &&
          event.payload.toolCallId === "tool-1",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "tool.execution.update",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "tool.execution.end",
      ),
    ).toBe(true);

    cleanup();
  });

  test("sdk traces with smithers-observed tool lifecycle degrade to partial-observed instead of final-only", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-sdk-tools";

    class OpenAIAgentWithToolsFake {
      id = "openai-sdk-tools-fake";
      tools = {};
      async generate() {
        const startedCall = await runPromise(logToolCallStartEffect("bash"));
        await runPromise(
          logToolCallEffect(
            "bash",
            { cmd: "echo hi" },
            { ok: true },
            "success",
            undefined,
            undefined,
            startedCall?.seq,
            startedCall?.toolCallId,
          ),
        );
        return {
          text: '{"answer":"sdk tool final"}',
          output: { answer: "sdk tool final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="sdk-tool-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new OpenAIAgentWithToolsFake() as any}
        >
          sdk tools please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.traceCompleteness).toBe("partial-observed");
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "tool.execution.start",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "tool.execution.end",
      ),
    ).toBe(true);
    const toolStart = traceEvents.find(
      (event: any) => event.event.kind === "tool.execution.start",
    );
    const toolEnd = traceEvents.find(
      (event: any) => event.event.kind === "tool.execution.end",
    );
    expect(toolStart?.payload.toolCallId).toBe("bash:1");
    expect(toolEnd?.payload.toolCallId).toBe("bash:1");
    expect(toolStart?.source.rawEventId).toBeTruthy();
    expect(toolEnd?.source.rawEventId).toBeTruthy();
    expect(toolStart?.source.rawEventId).not.toBe(toolEnd?.source.rawEventId);

    cleanup();
  });

  test("classifies truncated structured streams as capture-failed", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-truncated-stream";

    class CodexAgentTruncatedFake {
      id = "codex-truncated-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "assistant_message.delta",
            delta: { text: "partial" },
          }) + "\n",
        );
        args.onStdout?.(
          '{"type":"assistant_message.delta","delta":{"text":"unterminated"}',
        );
        throw new Error("subprocess exits early");
      }
    }

    const workflow = smithers(() => (
      <Workflow name="truncated-structured-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new CodexAgentTruncatedFake() as any}
          retries={0}
        >
          truncated codex please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("failed");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.traceCompleteness).toBe("capture-failed");
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "capture.error" &&
          event.payload.reason === "truncated-json-stream",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "assistant.message.final",
      ),
    ).toBe(false);

    cleanup();
  });

  test("records artifact write failures as capture warnings while durable DB truth remains", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-artifact-write-fail";
    const tmp = mkdtempSync(join(tmpdir(), "smithers-agent-trace-"));
    const badLogPath = join(tmp, "not-a-directory");
    writeFileSync(badLogPath, "occupied");

    class GeminiAgentArtifactFake {
      id = "gemini-artifact-fake";
      opts = { outputFormat: "stream-json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(
          JSON.stringify({
            type: "response.output_text.delta",
            delta: { text: "artifact delta" },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "response.completed",
            response: {
              role: "assistant",
              content: [{ text: "artifact final" }],
            },
          }) + "\n",
        );
        return {
          text: '{"answer":"artifact final"}',
          output: { answer: "artifact final" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="artifact-write-fail-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new GeminiAgentArtifactFake() as any}
        >
          artifact write failure please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, {
      input: {},
      runId,
      logDir: badLogPath,
    });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.traceCompleteness).toBe("partial-observed");
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "capture.warning" &&
          event.payload.reason === "artifact-write-failed",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "assistant.message.final",
      ),
    ).toBe(true);
    expect(
      traceEvents.some(
        (event: any) => event.event.kind === "artifact.created",
      ),
    ).toBe(false);

    cleanup();
  });

  test("records artifact rewrite failures as capture warnings without failing the run", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-artifact-rewrite-fail";
    const originalRewriteNdjson = (AgentTraceCollector.prototype as any).rewriteNdjson;
    (AgentTraceCollector.prototype as any).rewriteNdjson = async function () {
      throw new Error("rewrite exploded");
    };

    class PiAgentRewriteFake {
      id = "pi-rewrite-fake";
      opts = { mode: "json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(JSON.stringify({ type: "session", id: "sess-1" }) + "\n");
        args.onStdout?.(JSON.stringify({ type: "turn_start" }) + "\n");
        args.onStdout?.(
          JSON.stringify({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "rewrite final" }],
            },
          }) + "\n",
        );
        return {
          text: '{"answer":"rewrite final"}',
          output: { answer: "rewrite final" },
        };
      }
    }

    try {
      const workflow = smithers(() => (
        <Workflow name="artifact-rewrite-fail-trace">
          <Task
            id="task"
            output={outputs.result}
            agent={new PiAgentRewriteFake() as any}
          >
            rewrite fail please
          </Task>
        </Workflow>
      ));

      const result = await runWorkflow(workflow, { input: {}, runId });
      expect(result.status).toBe("finished");

      const events = await listRunEvents(db, runId);
      const summary = JSON.parse(
        events.find((event: any) => event.type === "AgentTraceSummary")!
          .payloadJson,
      ).summary;
      const traceEvents = events
        .filter((event: any) => event.type === "AgentTraceEvent")
        .map((event: any) => JSON.parse(event.payloadJson).trace);

      expect(summary.traceCompleteness).toBe("partial-observed");
      expect(
        traceEvents.some(
          (event: any) =>
            event.event.kind === "capture.warning" &&
            event.payload.reason === "artifact-rewrite-failed",
        ),
      ).toBe(true);
      expect(
        traceEvents.some(
          (event: any) => event.event.kind === "artifact.created",
        ),
      ).toBe(true);
    } finally {
      (AgentTraceCollector.prototype as any).rewriteNdjson = originalRewriteNdjson;
      cleanup();
    }
  });

  test("records persisted trace artifacts with a canonical artifact.created event", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-artifact-created";
    const logDir = mkdtempSync(join(tmpdir(), "smithers-agent-trace-artifact-"));

    class PiArtifactAgentFake {
      id = "pi-artifact-fake";
      opts = { mode: "json" };
      async generate(args: { onStdout?: (text: string) => void }) {
        args.onStdout?.(JSON.stringify({ type: "session", id: "sess-1" }) + "\n");
        args.onStdout?.(
          JSON.stringify({
            type: "turn_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "artifact ok" }],
            },
          }) + "\n",
        );
        args.onStdout?.(JSON.stringify({ type: "agent_end" }) + "\n");
        return {
          text: '{"answer":"artifact ok"}',
          output: { answer: "artifact ok" },
        };
      }
    }

    const workflow = smithers(() => (
      <Workflow name="artifact-created-trace">
        <Task
          id="task"
          output={outputs.result}
          agent={new PiArtifactAgentFake() as any}
        >
          artifact created please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, {
      input: {},
      runId,
      logDir,
    });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const summary = JSON.parse(
      events.find((event: any) => event.type === "AgentTraceSummary")!
        .payloadJson,
    ).summary;
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(summary.rawArtifactRefs).toHaveLength(1);
    expect(
      traceEvents.some(
        (event: any) =>
          event.event.kind === "artifact.created" &&
          event.payload.artifactPath === summary.rawArtifactRefs[0],
      ),
    ).toBe(true);
    const artifactText = readFileSync(summary.rawArtifactRefs[0], "utf8");
    expect(artifactText).toContain('"assistant.message.final"');
    expect(artifactText).toContain('"artifact.created"');
    expect(artifactText).toContain(summary.rawArtifactRefs[0]);

    cleanup();
  });

  test("detects Anthropic agents without colliding with Pi matching", () => {
    class AnthropicAgent {}
    const anthropicAgent = new AnthropicAgent() as any;
    anthropicAgent.id = "anthropic-sdk";

    expect(detectAgentFamily(anthropicAgent)).toBe("anthropic");
    expect(detectCaptureMode(anthropicAgent)).toBe("sdk-events");
  });

  test("marks normalized structured events as derived instead of directly observed", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-trace-derived-normalization";

    const codexLikeAgent: any = {
      id: "codex-derived-fake",
      opts: { outputFormat: "stream-json", json: true },
      generate: async (args: { onStdout?: (text: string) => void }) => {
        args.onStdout?.(
          JSON.stringify({
            type: "assistant_message.delta",
            delta: { text: "codex delta" },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 3, output_tokens: 1 },
            message: { role: "assistant", content: "codex final" },
          }) + "\n",
        );
        return {
          text: '{"answer":"codex final"}',
          output: { answer: "codex final" },
        };
      },
    };

    const workflow = smithers(() => (
      <Workflow name="derived-normalization">
        <Task id="task" output={outputs.result} agent={codexLikeAgent}>
          normalize this
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const traceEvents = events
      .filter((event: any) => event.type === "AgentTraceEvent")
      .map((event: any) => JSON.parse(event.payloadJson).trace);

    expect(
      traceEvents.find(
        (event: any) => event.event.kind === "assistant.text.delta",
      )?.source.observed,
    ).toBe(false);
    expect(
      traceEvents.find(
        (event: any) => event.event.kind === "assistant.message.final",
      )?.source.observed,
    ).toBe(false);
    expect(
      traceEvents.find((event: any) => event.event.kind === "usage")?.source
        .observed,
    ).toBe(false);

    cleanup();
  });

  test("captures live Claude session rows and backfills missing project transcript rows", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-session-claude-backfill";
    const sessionRoot = mkdtempSync(join(tmpdir(), "smithers-claude-session-"));
    const sessionId = "claude-session-test";
    const projectDir = join(
      sessionRoot,
      process.cwd().replace(/[\\/]/g, "-"),
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: "queue-operation",
          operation: "enqueue",
          sessionId,
          content: "prompt",
        }),
        JSON.stringify({
          type: "progress",
          sessionId,
          data: { type: "hook_progress", hookEvent: "SessionStart" },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const claudeLikeAgent: any = {
      id: "claude-session-fake",
      opts: {
        outputFormat: "stream-json",
        claudeProjectsDir: sessionRoot,
      },
      cd: "/tmp/smithers/test/workflow",
      generate: async (args: { onStdout?: (text: string) => void }) => {
        args.onStdout?.(
          JSON.stringify({
            type: "system",
            subtype: "init",
            session_id: sessionId,
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "assistant",
            session_id: sessionId,
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Claude session answer" }],
            },
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "result",
            session_id: sessionId,
            subtype: "success",
            result: "Claude session answer",
          }) + "\n",
        );
        return {
          text: '{"answer":"Claude session answer"}',
          output: { answer: "Claude session answer" },
        };
      },
    };

    const workflow = smithers(() => (
      <Workflow name="claude-session-transcript">
        <Task id="task" output={outputs.result} agent={claudeLikeAgent}>
          transcript please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, {
      input: {},
      runId,
    } as any);
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const sessionEvents = events
      .filter((event: any) => event.type === "AgentSessionEvent")
      .map((event: any) => JSON.parse(event.payloadJson).transcript);

    expect(
      sessionEvents.some(
        (event: any) =>
          event.event.rowType === "system" &&
          event.source.ingestSource === "live",
      ),
    ).toBe(true);
    expect(
      sessionEvents.some(
        (event: any) =>
          event.event.rowType === "queue-operation" &&
          event.source.ingestSource === "artifact",
      ),
    ).toBe(true);
    expect(
      sessionEvents.every(
        (event: any) => event.source.providerSessionId === sessionId,
      ),
    ).toBe(true);

    cleanup();
  });

  test("backfills Pi session transcript rows from the session directory", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-session-pi-backfill";
    const sessionRoot = mkdtempSync(join(tmpdir(), "smithers-pi-session-"));
    const sessionId = "pi-session-test";
    writeFileSync(
      join(sessionRoot, `2026-03-29T00-00-00-000Z_${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: "session",
          id: sessionId,
          cwd: "/tmp/pi-session-test",
        }),
        JSON.stringify({
          type: "model_change",
          modelId: "kimi-k2.5",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const piLikeAgent: any = {
      id: "pi-session-fake",
      opts: { mode: "json", sessionDir: sessionRoot },
      generate: async (args: { onStdout?: (text: string) => void }) => {
        args.onStdout?.(
          JSON.stringify({ type: "session", id: sessionId }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "PI session answer" }],
            },
          }) + "\n",
        );
        return {
          text: '{"answer":"PI session answer"}',
          output: { answer: "PI session answer" },
        };
      },
    };

    const workflow = smithers(() => (
      <Workflow name="pi-session-transcript">
        <Task id="task" output={outputs.result} agent={piLikeAgent}>
          transcript please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const sessionEvents = events
      .filter((event: any) => event.type === "AgentSessionEvent")
      .map((event: any) => JSON.parse(event.payloadJson).transcript);

    expect(
      sessionEvents.some((event: any) => event.event.rowType === "model_change"),
    ).toBe(true);

    cleanup();
  });

  test("backfills Codex session transcript rows from the persisted session store", async () => {
    const { smithers, outputs, db, cleanup } = createTestSmithers({
      result: z.object({ answer: z.string() }),
    });
    const runId = "agent-session-codex-backfill";
    const sessionRoot = mkdtempSync(join(tmpdir(), "smithers-codex-session-"));
    const now = new Date();
    const datedDir = join(
      sessionRoot,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
    );
    mkdirSync(datedDir, { recursive: true });
    const sessionFile = join(datedDir, "rollout-test.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "codex-session-test",
            timestamp: new Date().toISOString(),
            cwd: process.cwd(),
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "agent_reasoning",
            text: "Checking the codebase",
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const codexLikeAgent: any = {
      id: "codex-session-fake",
      opts: { outputFormat: "stream-json", json: true, sessionDir: sessionRoot },
      generate: async (args: { onStdout?: (text: string) => void }) => {
        args.onStdout?.(
          JSON.stringify({
            type: "thread.started",
            thread_id: "thread-live-1",
          }) + "\n",
        );
        args.onStdout?.(
          JSON.stringify({
            type: "turn.completed",
            message: { role: "assistant", content: "Codex session answer" },
          }) + "\n",
        );
        return {
          text: '{"answer":"Codex session answer"}',
          output: { answer: "Codex session answer" },
        };
      },
    };

    const workflow = smithers(() => (
      <Workflow name="codex-session-transcript">
        <Task id="task" output={outputs.result} agent={codexLikeAgent}>
          transcript please
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {}, runId });
    expect(result.status).toBe("finished");

    const events = await listRunEvents(db, runId);
    const sessionEvents = events
      .filter((event: any) => event.type === "AgentSessionEvent")
      .map((event: any) => JSON.parse(event.payloadJson).transcript);

    expect(
      sessionEvents.some(
        (event: any) =>
          event.event.rowType === "event_msg" &&
          event.source.ingestSource === "artifact",
      ),
    ).toBe(true);
    expect(
      sessionEvents.some(
        (event: any) => event.source.providerThreadId === "thread-live-1",
      ),
    ).toBe(true);

    cleanup();
  });

  test("shapes OTEL log records with canonical query attributes and redacted body", () => {
    const record = canonicalTraceEventToOtelLogRecord(
      {
        traceVersion: "1",
        runId: "run-123",
        workflowPath: "workflows/demo.tsx",
        workflowHash: "abc123",
        nodeId: "pi-rich-trace",
        iteration: 0,
        attempt: 1,
        timestampMs: Date.now(),
        event: {
          sequence: 7,
          kind: "assistant.thinking.delta",
          phase: "message",
        },
        source: {
          agentFamily: "pi",
          captureMode: "cli-json-stream",
          rawType: "thinking_delta",
          rawEventId: "thinking_delta:0",
          observed: true,
        },
        traceCompleteness: "full-observed",
        payload: { text: "thought [REDACTED_SECRET]" },
        raw: { text: "thought [REDACTED_SECRET]" },
        redaction: { applied: true, ruleIds: ["secret-ish"] },
        annotations: { "custom.demo": true, ticket: "OBS-1" },
      },
      {
        agentId: "pi-agent",
        model: "gpt-5.4",
      },
    );

    expect(record.severity).toBe("INFO");
    expect(record.attributes["run.id"]).toBe("run-123");
    expect(record.attributes["node.id"]).toBe("pi-rich-trace");
    expect(record.attributes["node.attempt"]).toBe(1);
    expect(record.attributes["smithers.event.category"]).toBe("agent-trace");
    expect(record.attributes["event.kind"]).toBe("assistant.thinking.delta");
    expect(record.attributes["source.raw_event_id"]).toBe("thinking_delta:0");
    expect(record.attributes["custom.ticket"]).toBe("OBS-1");
    expect(record.body).toContain("\"category\":\"agent-trace\"");
    expect(record.body).toContain("REDACTED_SECRET");
    expect(record.body).not.toContain("sk_live_");
  });

  test("shapes OTEL log records for provider session transcript rows", () => {
    const record = agentSessionEventToOtelLogRecord(
      {
        transcriptVersion: "1",
        runId: "run-123",
        workflowPath: "workflows/demo.tsx",
        workflowHash: "abc123",
        nodeId: "codex-session",
        iteration: 0,
        attempt: 1,
        timestampMs: Date.now(),
        event: {
          sequence: 4,
          rowType: "event_msg",
        },
        source: {
          agentFamily: "codex",
          captureMode: "cli-json-stream",
          ingestSource: "artifact",
          observedLive: false,
          providerSessionId: "sess-1",
          providerThreadId: "thread-1",
        },
        raw: {
          type: "event_msg",
          payload: { type: "agent_reasoning", text: "token=[REDACTED_SECRET]" },
        },
        redaction: { applied: true, ruleIds: ["secret-ish"] },
        annotations: { "custom.demo": true },
      },
      { agentId: "codex-agent", model: "gpt-5.4" },
    );

    expect(record.attributes["provider.session_id"]).toBe("sess-1");
    expect(record.attributes["provider.thread_id"]).toBe("thread-1");
    expect(record.attributes["smithers.event.category"]).toBe("agent-session");
    expect(record.attributes["session.ingest_source"]).toBe("artifact");
    expect(record.body).toContain("\"category\":\"agent-session\"");
    expect(record.body).toContain("REDACTED_SECRET");
  });
});
