import { describe, expect, test } from "bun:test";
import { Metric } from "effect";
import {
  PI_AGENT_TRACE_CAPABILITY_PROFILE,
  httpRequestDuration,
  renderPrometheusMetrics,
  runsTotal,
  toPersistedAgentTraceRecord,
} from "../src/observability";
import { runPromise } from "../src/effect/runtime";
import type { SmithersAgentTraceEvent } from "../src/SmithersEvent";

describe("Prometheus metrics", () => {
  test("renders built-in Smithers metrics in Prometheus exposition format", async () => {
    await runPromise(Metric.increment(runsTotal));
    await runPromise(Metric.update(httpRequestDuration, 42));

    const output = renderPrometheusMetrics();

    expect(output).toContain("# TYPE smithers_runs_total counter");
    expect(output).toContain("smithers_runs_total");
    expect(output).toContain(
      "# TYPE smithers_http_request_duration_ms histogram",
    );
    expect(output).toContain("smithers_http_request_duration_ms_bucket");
    expect(output).toContain("smithers_http_request_duration_ms_count");
  });
});

describe("agent trace observability", () => {
  test("declares the implemented Pi trace slice truthfully", () => {
    expect(PI_AGENT_TRACE_CAPABILITY_PROFILE.traceVersion).toBe(1);
    expect(PI_AGENT_TRACE_CAPABILITY_PROFILE.agentFamily).toBe("pi");
    expect(PI_AGENT_TRACE_CAPABILITY_PROFILE.traceCompleteness).toBe("partial-observed");
    expect(PI_AGENT_TRACE_CAPABILITY_PROFILE.supportedEventKinds).toEqual([
      "assistant.text.delta",
      "tool.execution.start",
      "tool.execution.update",
      "tool.execution.end",
    ]);
    expect(PI_AGENT_TRACE_CAPABILITY_PROFILE.unsupportedEventKinds).toContain(
      "assistant.thinking.delta",
    );
    expect(PI_AGENT_TRACE_CAPABILITY_PROFILE.captureModes).toContain("cli-json");
    expect(PI_AGENT_TRACE_CAPABILITY_PROFILE.captureModes).toContain("rpc-events");
  });

  test("flattens canonical trace events into queryable persisted records", () => {
    const event: SmithersAgentTraceEvent = {
      type: "AgentTraceEvent",
      traceVersion: 1,
      traceCompleteness: "partial-observed",
      unsupportedEventKinds: ["assistant.thinking.delta", "assistant.message.final"],
      runId: "run-1",
      workflowPath: "/tmp/workflow.tsx",
      workflowHash: "workflow-hash",
      nodeId: "node-a",
      iteration: 2,
      attempt: 3,
      timestampMs: 123,
      event: {
        sequence: 4,
        kind: "tool.execution.end",
        phase: "tool",
      },
      source: {
        agentFamily: "pi",
        agentId: "pi-agent-id",
        model: "gpt-5.2-codex",
        captureMode: "rpc-events",
        rawType: "tool_execution_end",
        observed: true,
      },
      payload: {
        toolCallId: "tool-1",
        toolName: "read",
        isError: false,
      },
      raw: { type: "tool_execution_end" },
      redaction: null,
      annotations: { "custom.test": true },
    };

    const record = toPersistedAgentTraceRecord(event);

    expect(record).toEqual({
      traceVersion: 1,
      traceCompleteness: "partial-observed",
      unsupportedEventKinds: ["assistant.thinking.delta", "assistant.message.final"],
      runId: "run-1",
      workflowPath: "/tmp/workflow.tsx",
      workflowHash: "workflow-hash",
      nodeId: "node-a",
      iteration: 2,
      attempt: 3,
      timestampMs: 123,
      eventSequence: 4,
      eventKind: "tool.execution.end",
      eventPhase: "tool",
      agentFamily: "pi",
      agentId: "pi-agent-id",
      agentModel: "gpt-5.2-codex",
      captureMode: "rpc-events",
      rawType: "tool_execution_end",
      observed: true,
      payload: {
        toolCallId: "tool-1",
        toolName: "read",
        isError: false,
      },
      raw: { type: "tool_execution_end" },
      redaction: null,
      annotations: { "custom.test": true },
    });
  });
});
