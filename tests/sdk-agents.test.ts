import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { AnthropicAgent, OpenAIAgent } from "../src/agents";

function createFakeModel() {
  let lastCall: any;
  return {
    model: {
      specificationVersion: "v3" as const,
      provider: "test-provider",
      modelId: "fake-model",
      get supportedUrls() {
        return {};
      },
      async doGenerate(options: any) {
        lastCall = options;
        return {
          content: [{ type: "text", text: "hello from sdk agent" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        };
      },
      async doStream() {
        throw new Error("stream not implemented in test");
      },
    },
    getLastCall() {
      return lastCall;
    },
  };
}

describe("SDK agents", () => {
  test("AnthropicAgent accepts a prebuilt model and preserves instructions", async () => {
    const fake = createFakeModel();
    const agent = new AnthropicAgent({
      id: "anthropic-sdk",
      model: fake.model as any,
      instructions: "You are a reviewer.",
    });

    const result = await agent.generate({ prompt: "review this file" });

    expect(result.text).toBe("hello from sdk agent");
    expect(fake.getLastCall()?.prompt?.[0]?.role).toBe("system");
    expect(fake.getLastCall()?.prompt?.[0]?.content).toBe(
      "You are a reviewer.",
    );
  });

  test("OpenAIAgent accepts a prebuilt model and preserves instructions", async () => {
    const fake = createFakeModel();
    const agent = new OpenAIAgent({
      id: "openai-sdk",
      model: fake.model as any,
      instructions: "You are an implementer.",
    });

    const result = await agent.generate({ prompt: "write the patch" });

    expect(result.text).toBe("hello from sdk agent");
    expect(fake.getLastCall()?.prompt?.[0]?.role).toBe("system");
    expect(fake.getLastCall()?.prompt?.[0]?.content).toBe(
      "You are an implementer.",
    );
  });

  test("OpenAIAgent streams assistant deltas through onStdout", async () => {
    const model = new MockLanguageModelV3({
      modelId: "mock-stream-model",
      doGenerate: async () => ({
        content: [{ type: "text", text: "generate-path" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "hello" },
            { type: "text-delta", id: "text-1", delta: " world" },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 2, text: 2, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    });
    const agent = new OpenAIAgent({
      id: "openai-sdk-stream",
      model: model as any,
    });

    let streamed = "";
    const result = await agent.generate({
      prompt: "stream this",
      onStdout: (text) => {
        streamed += text;
      },
    });

    expect(result.text).toBe("hello world");
    expect(streamed).toBe("hello world");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
