import { spawn } from "node:child_process";
import { Effect } from "effect";
import { toError } from "./interop";

export type SpawnCaptureOptions = {
  cwd: string;
  env?: Record<string, string | undefined>;
  input?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxOutputBytes?: number;
  detached?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type SpawnCaptureResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString("utf8");
}

export function spawnCaptureEffect(
  command: string,
  args: string[],
  options: SpawnCaptureOptions,
): Effect.Effect<SpawnCaptureResult, Error> {
  const {
    cwd,
    env,
    input,
    signal,
    timeoutMs,
    idleTimeoutMs,
    maxOutputBytes = 200_000,
    detached = false,
    onStdout,
    onStderr,
  } = options;

  return Effect.async<SpawnCaptureResult, Error>((resume) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      env,
      detached,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const kill = (reason: string) => {
      try {
        if (detached && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      if (!settled) {
        settled = true;
        resume(Effect.fail(new Error(reason)));
      }
    };

    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (idleTimeoutMs) {
        idleTimer = setTimeout(() => {
          kill(`CLI idle timed out after ${idleTimeoutMs}ms`);
        }, idleTimeoutMs);
      }
    };

    if (timeoutMs) {
      totalTimer = setTimeout(() => {
        kill(`CLI timed out after ${timeoutMs}ms`);
      }, timeoutMs);
    }
    resetIdle();

    const finalize = (result: SpawnCaptureResult) => {
      if (settled) return;
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      resume(Effect.succeed(result));
    };

    if (signal) {
      if (signal.aborted) {
        kill("CLI aborted");
      } else {
        signal.addEventListener("abort", () => kill("CLI aborted"), {
          once: true,
        });
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      resetIdle();
      const text = chunk.toString("utf8");
      stdout = truncateToBytes(stdout + text, maxOutputBytes);
      onStdout?.(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      resetIdle();
      const text = chunk.toString("utf8");
      stderr = truncateToBytes(stderr + text, maxOutputBytes);
      onStderr?.(text);
    });

    child.on("error", (error) => {
      if (totalTimer) clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (!settled) {
        settled = true;
        resume(Effect.fail(toError(error, `spawn ${command}`)));
      }
    });

    child.on("close", (code) => {
      finalize({ stdout, stderr, exitCode: code ?? null });
    });

    if (input) {
      child.stdin?.write(input);
    }
    child.stdin?.end();

    return Effect.sync(() => {
      if (totalTimer) clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      try {
        if (!settled) {
          if (detached && child.pid) {
            process.kill(-child.pid, "SIGKILL");
          } else {
            child.kill("SIGKILL");
          }
        }
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    });
  }).pipe(
    Effect.annotateLogs({
      command,
      args: args.join(" "),
      cwd,
      timeoutMs: timeoutMs ?? null,
      idleTimeoutMs: idleTimeoutMs ?? null,
    }),
    Effect.annotateSpans({
      command,
      args: args.join(" "),
      cwd,
      timeoutMs: timeoutMs ?? null,
      idleTimeoutMs: idleTimeoutMs ?? null,
    }),
    Effect.withLogSpan(`process:${command}`),
    Effect.withSpan(`process:${command}`, {
      attributes: {
        command,
        args: args.join(" "),
        cwd,
        timeoutMs: timeoutMs ?? null,
        idleTimeoutMs: idleTimeoutMs ?? null,
      },
    }),
  );
}
