/** @jsxImportSource smithers */
import { runPromise } from "../src/effect/runtime";
import { logToolCallEffect, logToolCallStartEffect } from "../src/tools/logToolCall";
import { createSmithers, Task, Workflow } from "../src";
import { z } from "zod";

const PiOutput = z.object({
  answer: z.string(),
});

const ClaudeOutput = z.object({
  answer: z.string(),
});

const CodexOutput = z.object({
  answer: z.string(),
});

const GeminiOutput = z.object({
  answer: z.string(),
});

const SdkOutput = z.object({
  answer: z.string(),
});

const { smithers, outputs } = createSmithers(
  {
    piResult: PiOutput,
    claudeResult: ClaudeOutput,
    codexResult: CodexOutput,
    geminiResult: GeminiOutput,
    sdkResult: SdkOutput,
  },
  {
    dbPath: "./workflows/agent-trace-otel-demo.db",
    journalMode: "DELETE",
  },
);

function createPiDemoAgent(failureMode?: string) {
  return {
    id: failureMode ? `pi-observability-demo-${failureMode}` : "pi-observability-demo",
    model: "demo-pi",
    opts: { mode: "json" },
    generate: async (args: { onStdout?: (text: string) => void }) => {
      if (failureMode === "malformed-json") {
        args.onStdout?.("{not valid json}\n");
        throw new Error("demo malformed-json failure");
      }
      args.onStdout?.(JSON.stringify({ type: "session", id: "demo-session" }) + "\n");
      args.onStdout?.(JSON.stringify({ type: "turn_start", id: "turn-1" }) + "\n");
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
            delta: "Planning demo work with token=sk_demo_secret_123456789",
          },
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "Working through the repository. ",
          },
        }) + "\n",
      );
      const seq = await runPromise(logToolCallStartEffect("bash"));
      await runPromise(
        logToolCallEffect(
          "bash",
          { command: "echo sk_live_secret_123456789" },
          { ok: true, stdout: "done" },
          "success",
          undefined,
          undefined,
          typeof seq === "number" ? seq : undefined,
        ),
      );
      args.onStdout?.(
        JSON.stringify({
          type: "tool_execution_start",
          toolExecution: {
            id: "tool-1",
            name: "bash",
            args: { command: "echo hi" },
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
          toolExecution: {
            id: "tool-1",
            name: "bash",
            result: { ok: true },
          },
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Demo PI answer" }],
            usage: { inputTokens: 11, outputTokens: 7 },
          },
        }) + "\n",
      );
      args.onStdout?.(JSON.stringify({ type: "agent_end", id: "demo-session" }) + "\n");
      return {
        text: '{"answer":"Demo PI answer"}',
        output: { answer: "Demo PI answer" },
        usage: { inputTokens: 11, outputTokens: 7 },
      };
    },
  } as any;
}

function createClaudeDemoAgent() {
  return {
    id: "claude-observability-demo",
    model: "demo-claude",
    opts: { outputFormat: "stream-json" },
    generate: async (args: { onStdout?: (text: string) => void }) => {
      args.onStdout?.(
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "claude-demo-session",
          model: "claude-opus-demo",
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Claude demo answer" }],
            usage: {
              input_tokens: 13,
              cache_read_input_tokens: 2,
              output_tokens: 5,
            },
          },
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Claude demo answer",
          usage: {
            input_tokens: 13,
            cache_read_input_tokens: 2,
            output_tokens: 5,
          },
        }) + "\n",
      );
      return {
        text: '{"answer":"Claude demo answer"}',
        output: { answer: "Claude demo answer" },
      };
    },
  } as any;
}

function createGeminiDemoAgent() {
  return {
    id: "gemini-observability-demo",
    model: "demo-gemini",
    opts: { outputFormat: "stream-json" },
    generate: async (args: { onStdout?: (text: string) => void }) => {
      args.onStdout?.(
        JSON.stringify({
          type: "init",
          session_id: "gemini-demo-session",
          model: "gemini-demo",
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: "Gemini ",
          delta: true,
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: "demo answer",
          delta: true,
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "result",
          status: "success",
          stats: {
            input_tokens: 9,
            output_tokens: 4,
            total_tokens: 13,
          },
        }) + "\n",
      );
      return {
        text: '{"answer":"Gemini demo answer"}',
        output: { answer: "Gemini demo answer" },
      };
    },
  } as any;
}

function createCodexDemoAgent() {
  return {
    id: "codex-observability-demo",
    model: "demo-codex",
    opts: { outputFormat: "stream-json", json: true },
    generate: async (args: { onStdout?: (text: string) => void }) => {
      args.onStdout?.(
        JSON.stringify({
          type: "assistant_message.delta",
          delta: { text: "Codex demo answer" },
        }) + "\n",
      );
      args.onStdout?.(
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 12, output_tokens: 6 },
          message: { role: "assistant", content: "Codex demo answer" },
        }) + "\n",
      );
      return {
        text: '{"answer":"Codex demo answer"}',
        output: { answer: "Codex demo answer" },
      };
    },
  } as any;
}

class OpenAIAgentDemo {
  id = "openai-demo-agent";
  model = "demo-sdk";
  tools = {};

  async generate() {
    return {
      text: '{"answer":"Demo SDK answer"}',
      output: { answer: "Demo SDK answer" },
      usage: { inputTokens: 5, outputTokens: 3 },
    };
  }
}

export default smithers((ctx) => {
  const failureMode = typeof ctx.input.failureMode === "string" ? ctx.input.failureMode : undefined;
  const piAgent = createPiDemoAgent(failureMode);

  return (
    <Workflow name="agent-trace-otel-demo">
      <Task id="pi-rich-trace" output={outputs.piResult} agent={piAgent} retries={0}>
        {`Emit a PI-like trace for observability verification. failureMode=${failureMode ?? "none"}`}
      </Task>
      {!failureMode && (
        <>
          <Task
            id="claude-structured-trace"
            output={outputs.claudeResult}
            agent={createClaudeDemoAgent()}
          >
            {`Emit a Claude-like structured trace after the PI demo task completes.`}
          </Task>
          <Task
            id="gemini-structured-trace"
            output={outputs.geminiResult}
            agent={createGeminiDemoAgent()}
          >
            {`Emit a Gemini-like structured trace after the Claude demo task completes.`}
          </Task>
          <Task
            id="codex-structured-trace"
            output={outputs.codexResult}
            agent={createCodexDemoAgent()}
          >
            {`Emit a Codex-like structured trace after the Gemini demo task completes.`}
          </Task>
          <Task id="sdk-final-only" output={outputs.sdkResult} agent={new OpenAIAgentDemo() as any}>
            {`Return a final-only SDK response after the structured PI, Claude, Gemini, and Codex demo tasks complete.`}
          </Task>
        </>
      )}
    </Workflow>
  );
});
