import { tool, zodSchema } from "ai";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { applyPatch } from "diff";
import { nowMs } from "../utils/time";
import { resolveSandboxPath, assertPathWithinRoot } from "./utils";
import { getToolContext, nextToolSeq } from "./context";

async function logToolCall(toolName: string, input: unknown, output: unknown, status: "success" | "error", error?: unknown, startedAtMs?: number) {
  const ctx = getToolContext();
  if (!ctx) return;
  const seq = nextToolSeq(ctx);
  const started = startedAtMs ?? nowMs();
  const finished = nowMs();
  await ctx.db.insertToolCall({
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    iteration: ctx.iteration,
    attempt: ctx.attempt,
    seq,
    toolName,
    inputJson: JSON.stringify(input ?? null),
    outputJson: JSON.stringify(output ?? null),
    startedAtMs: started,
    finishedAtMs: finished,
    status,
    errorJson: error ? JSON.stringify(error) : null,
  });
}

function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString("utf8");
}

export const read = tool({
  description: "Read a file",
  inputSchema: zodSchema(z.object({ path: z.string() })),
  execute: async ({ path }: { path: string }) => {
    const ctx = getToolContext();
    const root = ctx?.rootDir ?? process.cwd();
    const resolved = resolveSandboxPath(root, path);
    const started = nowMs();
    try {
      await assertPathWithinRoot(root, resolved);
      const max = ctx?.maxOutputBytes ?? 200_000;
      const stats = await fs.stat(resolved);
      if (stats.size > max) {
        throw new Error(`File too large (${stats.size} bytes)`);
      }
      const content = await fs.readFile(resolved, "utf8");
      const output = truncateToBytes(content, max);
      await logToolCall("read", { path }, { content: output }, "success", undefined, started);
      return output;
    } catch (err) {
      await logToolCall("read", { path }, null, "error", err, started);
      throw err;
    }
  },
});

export const write = tool({
  description: "Write a file",
  inputSchema: zodSchema(z.object({ path: z.string(), content: z.string() })),
  execute: async ({ path, content }: { path: string; content: string }) => {
    const ctx = getToolContext();
    const root = ctx?.rootDir ?? process.cwd();
    const resolved = resolveSandboxPath(root, path);
    const started = nowMs();
    try {
      await assertPathWithinRoot(root, resolved);
      await fs.mkdir(dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf8");
      await logToolCall("write", { path }, { ok: true }, "success", undefined, started);
      return "ok";
    } catch (err) {
      await logToolCall("write", { path }, null, "error", err, started);
      throw err;
    }
  },
});

export const edit = tool({
  description: "Apply a unified diff patch to a file",
  inputSchema: zodSchema(z.object({ path: z.string(), patch: z.string() })),
  execute: async ({ path, patch }: { path: string; patch: string }) => {
    const ctx = getToolContext();
    const root = ctx?.rootDir ?? process.cwd();
    const resolved = resolveSandboxPath(root, path);
    const started = nowMs();
    try {
      await assertPathWithinRoot(root, resolved);
      const max = ctx?.maxOutputBytes ?? 200_000;
      const stats = await fs.stat(resolved);
      if (stats.size > max) {
        throw new Error(`File too large (${stats.size} bytes)`);
      }
      const current = await fs.readFile(resolved, "utf8");
      const updated = applyPatch(current, patch);
      if (updated === false) {
        throw new Error("Failed to apply patch");
      }
      await fs.writeFile(resolved, updated, "utf8");
      await logToolCall("edit", { path }, { ok: true }, "success", undefined, started);
      return "ok";
    } catch (err) {
      await logToolCall("edit", { path }, null, "error", err, started);
      throw err;
    }
  },
});

export const grep = tool({
  description: "Search for a pattern in files",
  inputSchema: zodSchema(z.object({ pattern: z.string(), path: z.string().optional() })),
  execute: async ({ pattern, path }: { pattern: string; path?: string }) => {
    const ctx = getToolContext();
    const root = ctx?.rootDir ?? process.cwd();
    const resolvedRoot = resolveSandboxPath(root, path ?? ".");
    const started = nowMs();
    try {
      await assertPathWithinRoot(root, resolvedRoot);
      const results: string[] = [];
      const errors: string[] = [];
      const rg = spawn("rg", ["-n", pattern, resolvedRoot]);
      rg.stdout.on("data", (chunk) => results.push(chunk.toString("utf8")));
      rg.stderr.on("data", (chunk) => errors.push(chunk.toString("utf8")));
      const exitCode: number = await new Promise((resolve) => rg.on("close", resolve));
      const max = ctx?.maxOutputBytes ?? 200_000;
      const output = truncateToBytes(results.join(""), max);
      const errorText = errors.join("");
      if (exitCode === 2) {
        const err = new Error(errorText || "rg failed");
        await logToolCall("grep", { pattern, path }, { output }, "error", err, started);
        throw err;
      }
      await logToolCall("grep", { pattern, path }, { output }, "success", undefined, started);
      return output;
    } catch (err) {
      await logToolCall("grep", { pattern, path }, null, "error", err, started);
      throw err;
    }
  },
});

export const bash = tool({
  description: "Execute a shell command",
  inputSchema: zodSchema(
    z.object({
      cmd: z.string(),
      args: z.array(z.string()).optional(),
      opts: z.object({ cwd: z.string().optional() }).optional(),
    }),
  ),
  execute: async ({ cmd, args, opts }: { cmd: string; args?: string[]; opts?: { cwd?: string } }) => {
    const ctx = getToolContext();
    const root = ctx?.rootDir ?? process.cwd();
    const cwd = opts?.cwd ? resolveSandboxPath(root, opts.cwd) : root;
    const allowNetwork = ctx?.allowNetwork ?? false;
    const started = nowMs();
    await assertPathWithinRoot(root, cwd);

    if (!allowNetwork) {
      const forbidden = ["curl", "wget", "http://", "https://", "git", "npm", "bun", "pip"]; // coarse guard
      const hay = [cmd, ...(args ?? [])].join(" ");
      if (forbidden.some((f) => hay.includes(f))) {
        const err = new Error("Network access is disabled for bash tool");
        await logToolCall("bash", { cmd, args }, null, "error", err, started);
        throw err;
      }
    }

    const timeoutMs = ctx?.timeoutMs ?? 60_000;
    const maxOutputBytes = ctx?.maxOutputBytes ?? 200_000;

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, args ?? [], { cwd, env: process.env, detached: true });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid) {
            process.kill(-child.pid, "SIGKILL");
          }
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = Buffer.concat([stdout, chunk]);
        if (stdout.length > maxOutputBytes) {
          stdout = stdout.slice(0, maxOutputBytes);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = Buffer.concat([stderr, chunk]);
        if (stderr.length > maxOutputBytes) {
          stderr = stderr.slice(0, maxOutputBytes);
        }
      });
      child.on("error", async (err) => {
        clearTimeout(timer);
        await logToolCall("bash", { cmd, args }, null, "error", err, started);
        reject(err);
      });
      child.on("close", async (code, signal) => {
        clearTimeout(timer);
        const output = `${stdout.toString("utf8")}${stderr.toString("utf8")}`;
        if (timedOut) {
          const err = new Error(`Command timed out after ${timeoutMs}ms`);
          await logToolCall("bash", { cmd, args }, { output }, "error", err, started);
          reject(err);
          return;
        }
        if (code !== 0) {
          const err = new Error(signal ? `Command failed with signal ${signal}` : `Command failed with exit code ${code}`);
          await logToolCall("bash", { cmd, args }, { output }, "error", err, started);
          reject(err);
          return;
        }
        await logToolCall("bash", { cmd, args }, { output }, "success", undefined, started);
        resolve(output);
      });
    });
  },
});

export const tools = { read, write, edit, grep, bash };
