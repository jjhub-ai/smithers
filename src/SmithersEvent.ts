import type { RunStatus } from "./RunStatus";

export const CANONICAL_AGENT_TRACE_VERSION = 1 as const;

export type AgentTraceCompleteness =
  | "full-observed"
  | "partial-observed"
  | "final-only"
  | "capture-failed";

export type AgentTraceCaptureMode =
  | "sdk-events"
  | "rpc-events"
  | "cli-json-stream"
  | "cli-json"
  | "cli-text"
  | "artifact-import";

export type AgentTraceEventKind =
  | "session.start"
  | "session.end"
  | "turn.start"
  | "turn.end"
  | "message.start"
  | "message.update"
  | "message.end"
  | "assistant.text.delta"
  | "assistant.thinking.delta"
  | "assistant.message.final"
  | "tool.execution.start"
  | "tool.execution.update"
  | "tool.execution.end"
  | "tool.result"
  | "retry.start"
  | "retry.end"
  | "compaction.start"
  | "compaction.end"
  | "stderr"
  | "stdout"
  | "usage"
  | "capture.warning"
  | "capture.error"
  | "artifact.created";

export type AgentTraceEventPhase =
  | "message"
  | "tool"
  | "agent"
  | "session"
  | "turn"
  | "capture"
  | "artifact";

export const PI_AGENT_TRACE_SUPPORTED_EVENT_KINDS = [
  "assistant.text.delta",
  "tool.execution.start",
  "tool.execution.update",
  "tool.execution.end",
] as const satisfies readonly AgentTraceEventKind[];

export const PI_AGENT_TRACE_UNSUPPORTED_EVENT_KINDS = [
  "session.start",
  "session.end",
  "turn.start",
  "turn.end",
  "message.start",
  "message.update",
  "message.end",
  "assistant.thinking.delta",
  "assistant.message.final",
  "tool.result",
  "retry.start",
  "retry.end",
  "compaction.start",
  "compaction.end",
  "usage",
  "artifact.created",
] as const satisfies readonly AgentTraceEventKind[];

export type SmithersAgentTraceEvent = {
  type: "AgentTraceEvent";
  traceVersion: typeof CANONICAL_AGENT_TRACE_VERSION;
  traceCompleteness: AgentTraceCompleteness;
  unsupportedEventKinds: AgentTraceEventKind[];
  runId: string;
  workflowPath?: string | null;
  workflowHash?: string | null;
  nodeId: string;
  iteration: number;
  attempt: number;
  timestampMs: number;
  event: {
    sequence: number;
    kind: AgentTraceEventKind;
    phase: AgentTraceEventPhase;
  };
  source: {
    agentFamily: "pi";
    agentId?: string;
    model?: string;
    captureMode: AgentTraceCaptureMode;
    rawType?: string;
    observed: boolean;
  };
  payload: Record<string, unknown> | null;
  raw: unknown;
  redaction: { applied: boolean; ruleIds?: string[] } | null;
  annotations: Record<string, string | number | boolean> | null;
};

export type SmithersEvent =
  | { type: "RunStarted"; runId: string; timestampMs: number }
  | {
      type: "RunStatusChanged";
      runId: string;
      status: RunStatus;
      timestampMs: number;
    }
  | { type: "RunFinished"; runId: string; timestampMs: number }
  | { type: "RunFailed"; runId: string; error: unknown; timestampMs: number }
  | { type: "RunCancelled"; runId: string; timestampMs: number }
  | {
      type: "FrameCommitted";
      runId: string;
      frameNo: number;
      xmlHash: string;
      timestampMs: number;
    }
  | {
      type: "NodePending";
      runId: string;
      nodeId: string;
      iteration: number;
      timestampMs: number;
    }
  | {
      type: "NodeStarted";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      timestampMs: number;
    }
  | {
      type: "NodeFinished";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      timestampMs: number;
    }
  | {
      type: "NodeFailed";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      error: unknown;
      timestampMs: number;
    }
  | {
      type: "NodeCancelled";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt?: number;
      reason?: string;
      timestampMs: number;
    }
  | {
      type: "NodeSkipped";
      runId: string;
      nodeId: string;
      iteration: number;
      timestampMs: number;
    }
  | {
      type: "NodeRetrying";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      timestampMs: number;
    }
  | {
      type: "NodeWaitingApproval";
      runId: string;
      nodeId: string;
      iteration: number;
      timestampMs: number;
    }
  | {
      type: "ApprovalRequested";
      runId: string;
      nodeId: string;
      iteration: number;
      timestampMs: number;
    }
  | {
      type: "ApprovalGranted";
      runId: string;
      nodeId: string;
      iteration: number;
      timestampMs: number;
    }
  | {
      type: "ApprovalDenied";
      runId: string;
      nodeId: string;
      iteration: number;
      timestampMs: number;
    }
  | {
      type: "ToolCallStarted";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      toolName: string;
      seq: number;
      timestampMs: number;
    }
  | {
      type: "ToolCallFinished";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      toolName: string;
      seq: number;
      status: "success" | "error";
      timestampMs: number;
    }
  | {
      type: "NodeOutput";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      text: string;
      stream: "stdout" | "stderr";
      timestampMs: number;
    }
  | {
      type: "RevertStarted";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      jjPointer: string;
      timestampMs: number;
    }
  | {
      type: "RevertFinished";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      jjPointer: string;
      success: boolean;
      error?: string;
      timestampMs: number;
    }
  | {
      type: "WorkflowReloadDetected";
      runId: string;
      changedFiles: string[];
      timestampMs: number;
    }
  | {
      type: "WorkflowReloaded";
      runId: string;
      generation: number;
      changedFiles: string[];
      timestampMs: number;
    }
  | {
      type: "WorkflowReloadFailed";
      runId: string;
      error: unknown;
      changedFiles: string[];
      timestampMs: number;
    }
  | {
      type: "WorkflowReloadUnsafe";
      runId: string;
      reason: string;
      changedFiles: string[];
      timestampMs: number;
    }
  | {
      type: "TokenUsageReported";
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
      model: string;
      agent: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      reasoningTokens?: number;
      timestampMs: number;
    }
  | SmithersAgentTraceEvent;

export type ExtendedSmithersEvent = SmithersEvent;
