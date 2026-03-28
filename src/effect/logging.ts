import { Effect } from "effect";
import { runFork, runPromise } from "./runtime";

type LogAnnotations = Record<string, unknown> | undefined;

function withLogContext(
  effect: Effect.Effect<void, never, never>,
  annotations?: LogAnnotations,
  span?: string,
) {
  let program = effect;
  if (annotations) {
    program = program.pipe(Effect.annotateLogs(annotations));
  }
  if (span) {
    program = program.pipe(Effect.withLogSpan(span));
  }
  return program;
}

function emitLog(
  effect: Effect.Effect<void, never, never>,
  annotations?: LogAnnotations,
  span?: string,
) {
  void runFork(withLogContext(effect, annotations, span));
}

async function emitLogAwait(
  effect: Effect.Effect<void, never, never>,
  annotations?: LogAnnotations,
  span?: string,
) {
  await runPromise(withLogContext(effect, annotations, span));
}

export function logDebug(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  emitLog(Effect.logDebug(message), annotations, span);
}

export async function logDebugAwait(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  await emitLogAwait(Effect.logDebug(message), annotations, span);
}

export function logInfo(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  emitLog(Effect.logInfo(message), annotations, span);
}

export async function logInfoAwait(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  await emitLogAwait(Effect.logInfo(message), annotations, span);
}

export function logWarning(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  emitLog(Effect.logWarning(message), annotations, span);
}

export async function logWarningAwait(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  await emitLogAwait(Effect.logWarning(message), annotations, span);
}

export function logError(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  emitLog(Effect.logError(message), annotations, span);
}

export async function logErrorAwait(
  message: string,
  annotations?: LogAnnotations,
  span?: string,
) {
  await emitLogAwait(Effect.logError(message), annotations, span);
}
