import { Effect, Metric } from "effect";
import { nowMs } from "../utils/time";
import { errorToJson } from "../utils/errors";
import { getToolContext, nextToolSeq } from "./context";
import { runPromise } from "../effect/runtime";
import { toolDuration, toolOutputTruncatedTotal } from "../effect/metrics";

export function logToolCallEffect(
  toolName: string,
  input: unknown,
  output: unknown,
  status: "success" | "error",
  error?: unknown,
  startedAtMs?: number,
  seqOverride?: number,
) {
  const ctx = getToolContext();
  if (!ctx) return Effect.void;
  const seq =
    typeof seqOverride === "number" ? seqOverride : nextToolSeq(ctx);
  const started = startedAtMs ?? nowMs();
  const finished = nowMs();
  const durationMs = finished - started;
  const maxLogBytes = ctx.maxOutputBytes ?? 200_000;
  const inputLog = safeJson(input, maxLogBytes);
  const outputLog = safeJson(output, maxLogBytes);
  const errorLog = error ? safeJson(errorToJson(error), maxLogBytes) : null;
  const truncatedLogCount =
    (inputLog.truncated ? 1 : 0) +
    (outputLog.truncated ? 1 : 0) +
    (errorLog?.truncated ? 1 : 0);
  void ctx.emitEvent?.({
    type: "ToolCallFinished",
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    iteration: ctx.iteration,
    attempt: ctx.attempt,
    toolName,
    seq,
    status,
    timestampMs: finished,
  });
  return Effect.all([
    Metric.update(toolDuration, durationMs),
    truncatedLogCount > 0
      ? Metric.incrementBy(toolOutputTruncatedTotal, truncatedLogCount)
      : Effect.void,
  ], { discard: true }).pipe(
    Effect.andThen(
      ctx.db.insertToolCallEffect({
        runId: ctx.runId,
        nodeId: ctx.nodeId,
        iteration: ctx.iteration,
        attempt: ctx.attempt,
        seq,
        toolName,
        inputJson: inputLog.json,
        outputJson: outputLog.json,
        startedAtMs: started,
        finishedAtMs: finished,
        status,
        errorJson: errorLog?.json ?? null,
      }),
    ),
    Effect.annotateLogs({
      runId: ctx.runId,
      nodeId: ctx.nodeId,
      iteration: ctx.iteration,
      attempt: ctx.attempt,
      toolName,
      toolStatus: status,
    }),
    Effect.withLogSpan(`tool:${toolName}:log`),
  );
}

export async function logToolCall(
  toolName: string,
  input: unknown,
  output: unknown,
  status: "success" | "error",
  error?: unknown,
  startedAtMs?: number,
) {
  await runPromise(
    logToolCallEffect(toolName, input, output, status, error, startedAtMs),
  );
}

export function logToolCallStartEffect(
  toolName: string,
  startedAtMs?: number,
) {
  const ctx = getToolContext();
  if (!ctx) return Effect.succeed(undefined);
  const seq = nextToolSeq(ctx);
  const started = startedAtMs ?? nowMs();
  void ctx.emitEvent?.({
    type: "ToolCallStarted",
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    iteration: ctx.iteration,
    attempt: ctx.attempt,
    toolName,
    seq,
    timestampMs: started,
  });
  return Effect.succeed(seq);
}

export function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString("utf8");
}

export function safeJson(
  value: unknown,
  maxBytes: number,
): { json: string; truncated: boolean } {
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) {
    return { json, truncated: false };
  }
  const preview = truncateToBytes(json, maxBytes);
  return {
    json: JSON.stringify({
      truncated: true,
      bytes: Buffer.byteLength(json, "utf8"),
      preview,
    }),
    truncated: true,
  };
}
