import type { RetryPolicy } from "../RetryPolicy";

export function computeRetryDelayMs(
  policy: RetryPolicy | undefined,
  attempt: number,
): number {
  if (!policy) return 0;
  const base =
    typeof policy.initialDelayMs === "number"
      ? Math.max(0, Math.floor(policy.initialDelayMs))
      : 0;
  if (base <= 0) return 0;
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const backoff = policy.backoff ?? "fixed";
  let multiplier = 1;
  if (backoff === "linear") {
    multiplier = safeAttempt;
  } else if (backoff === "exponential") {
    multiplier = 2 ** (safeAttempt - 1);
  }
  return Math.max(0, Math.round(base * multiplier));
}
