import { getToolContext } from "./tools/context";
import { nowMs } from "./utils/time";
import {
  CANONICAL_AGENT_TRACE_VERSION,
  PI_AGENT_TRACE_UNSUPPORTED_EVENT_KINDS,
} from "./SmithersEvent";
import type {
  AgentTraceCaptureMode,
  AgentTraceEventKind,
  AgentTraceEventPhase,
  SmithersAgentTraceEvent,
} from "./SmithersEvent";

// Local, per-attempt monotonic sequence for canonical trace events
const traceSeq = new WeakMap<object, number>();

function nextTraceSeq(ctx: object): number {
  const current = traceSeq.get(ctx) ?? 0;
  const next = current + 1;
  traceSeq.set(ctx, next);
  return next;
}

export type CaptureMode = Extract<
  AgentTraceCaptureMode,
  "cli-json" | "cli-json-stream" | "rpc-events" | "cli-text"
>;

export type AgentTraceSourceMeta = {
  agentId?: string;
  model?: string;
};

export function emitAgentTrace(
  kind: AgentTraceEventKind,
  phase: AgentTraceEventPhase,
  payload: Record<string, unknown> | null | undefined,
  raw: unknown,
  rawType: string | undefined,
  captureMode: CaptureMode,
  sourceMeta?: AgentTraceSourceMeta,
) {
  const ctx = getToolContext();
  if (!ctx || typeof ctx.emitEvent !== "function") return; // outside workflow execution
  const ts = nowMs();
  const event: SmithersAgentTraceEvent = {
    type: "AgentTraceEvent",
    traceVersion: CANONICAL_AGENT_TRACE_VERSION,
    traceCompleteness: "partial-observed",
    unsupportedEventKinds: [...PI_AGENT_TRACE_UNSUPPORTED_EVENT_KINDS],
    runId: ctx.runId,
    workflowPath: ctx.workflowPath ?? null,
    workflowHash: ctx.workflowHash ?? null,
    nodeId: ctx.nodeId,
    iteration: ctx.iteration,
    attempt: ctx.attempt,
    timestampMs: ts,
    event: {
      sequence: nextTraceSeq(ctx),
      kind,
      phase,
    },
    source: {
      agentFamily: "pi",
      agentId: sourceMeta?.agentId,
      model: sourceMeta?.model,
      captureMode,
      rawType,
      observed: true,
    },
    payload: payload ?? null,
    raw,
    redaction: null,
    annotations: null,
  };
  void ctx.emitEvent(event);
}

export function capturePiEvent(
  event: any,
  captureMode: CaptureMode,
  sourceMeta?: AgentTraceSourceMeta,
) {
  if (!event || typeof event !== "object") return;
  const type = String((event as any).type ?? "");

  // Assistant text deltas
  if (type === "message_update") {
    const assistant = (event as any).assistantMessageEvent;
    if (assistant && assistant.type === "text_delta" && typeof assistant.delta === "string") {
      emitAgentTrace(
        "assistant.text.delta",
        "message",
        { text: assistant.delta },
        event,
        "message_update.text_delta",
        captureMode,
        sourceMeta,
      );
      return;
    }
  }

  // Tool lifecycle (best-effort mapping of common Pi shapes)
  if (type === "tool_execution_start") {
    const call = (event as any).toolCall ?? (event as any).call ?? (event as any);
    emitAgentTrace(
      "tool.execution.start",
      "tool",
      {
        toolCallId: String(call.id ?? call.toolCallId ?? ""),
        toolName: String(call.name ?? call.toolName ?? call.tool ?? ""),
        argsPreview: call.args ?? call.arguments ?? undefined,
      },
      event,
      "tool_execution_start",
      captureMode,
      sourceMeta,
    );
    return;
  }

  if (type === "tool_execution_update") {
    const call = (event as any).toolCall ?? (event as any).call ?? (event as any);
    emitAgentTrace(
      "tool.execution.update",
      "tool",
      {
        toolCallId: String(call.id ?? call.toolCallId ?? ""),
        toolName: String(call.name ?? call.toolName ?? call.tool ?? ""),
      },
      event,
      "tool_execution_update",
      captureMode,
      sourceMeta,
    );
    return;
  }

  if (type === "tool_execution_end") {
    const call = (event as any).toolCall ?? (event as any).call ?? (event as any);
    const isError = Boolean((event as any).error || (event as any).failed);
    emitAgentTrace(
      "tool.execution.end",
      "tool",
      {
        toolCallId: String(call.id ?? call.toolCallId ?? ""),
        toolName: String(call.name ?? call.toolName ?? call.tool ?? ""),
        isError,
        resultPreview: (event as any).result ?? (event as any).output ?? undefined,
      },
      event,
      "tool_execution_end",
      captureMode,
      sourceMeta,
    );
    return;
  }
}

export function capturePiNdjson(
  raw: string,
  captureMode: CaptureMode,
  sourceMeta?: AgentTraceSourceMeta,
) {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      capturePiEvent(parsed, captureMode, sourceMeta);
    } catch {
      // ignore malformed lines
    }
  }
}
