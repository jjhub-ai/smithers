import { Effect } from "effect";
import { nowMs } from "../utils/time";
import { SmithersDb } from "../db/adapter";
import { runPromise } from "../effect/runtime";

export function approveNodeEffect(
  adapter: SmithersDb,
  runId: string,
  nodeId: string,
  iteration: number,
  note?: string,
  decidedBy?: string,
) {
  const ts = nowMs();
  return Effect.gen(function* () {
    yield* adapter.insertOrUpdateApprovalEffect({
      runId,
      nodeId,
      iteration,
      status: "approved",
      requestedAtMs: null,
      decidedAtMs: ts,
      note: note ?? null,
      decidedBy: decidedBy ?? null,
    });
    yield* adapter.insertEventWithNextSeqEffect({
      runId,
      timestampMs: ts,
      type: "ApprovalGranted",
      payloadJson: JSON.stringify({
        type: "ApprovalGranted",
        runId,
        nodeId,
        iteration,
        timestampMs: ts,
      }),
    });
    yield* adapter.insertNodeEffect({
      runId,
      nodeId,
      iteration,
      state: "pending",
      lastAttempt: null,
      updatedAtMs: nowMs(),
      outputTable: "",
      label: null,
    });
  }).pipe(
    Effect.annotateLogs({ runId, nodeId, iteration, approvalStatus: "approved" }),
    Effect.annotateSpans({ runId, nodeId, iteration, approvalStatus: "approved" }),
    Effect.withLogSpan("approval:grant"),
    Effect.withSpan("approval:grant", { attributes: { runId, nodeId, iteration, approvalStatus: "approved" } }),
  );
}

export async function approveNode(
  adapter: SmithersDb,
  runId: string,
  nodeId: string,
  iteration: number,
  note?: string,
  decidedBy?: string,
) {
  await runPromise(
    approveNodeEffect(adapter, runId, nodeId, iteration, note, decidedBy),
  );
}

export function denyNodeEffect(
  adapter: SmithersDb,
  runId: string,
  nodeId: string,
  iteration: number,
  note?: string,
  decidedBy?: string,
) {
  const ts = nowMs();
  return Effect.gen(function* () {
    yield* adapter.insertOrUpdateApprovalEffect({
      runId,
      nodeId,
      iteration,
      status: "denied",
      requestedAtMs: null,
      decidedAtMs: ts,
      note: note ?? null,
      decidedBy: decidedBy ?? null,
    });
    yield* adapter.insertEventWithNextSeqEffect({
      runId,
      timestampMs: ts,
      type: "ApprovalDenied",
      payloadJson: JSON.stringify({
        type: "ApprovalDenied",
        runId,
        nodeId,
        iteration,
        timestampMs: ts,
      }),
    });
    yield* adapter.insertNodeEffect({
      runId,
      nodeId,
      iteration,
      state: "failed",
      lastAttempt: null,
      updatedAtMs: nowMs(),
      outputTable: "",
      label: null,
    });
  }).pipe(
    Effect.annotateLogs({ runId, nodeId, iteration, approvalStatus: "denied" }),
    Effect.annotateSpans({ runId, nodeId, iteration, approvalStatus: "denied" }),
    Effect.withLogSpan("approval:deny"),
    Effect.withSpan("approval:deny", { attributes: { runId, nodeId, iteration, approvalStatus: "denied" } }),
  );
}

export async function denyNode(
  adapter: SmithersDb,
  runId: string,
  nodeId: string,
  iteration: number,
  note?: string,
  decidedBy?: string,
) {
  await runPromise(
    denyNodeEffect(adapter, runId, nodeId, iteration, note, decidedBy),
  );
}
