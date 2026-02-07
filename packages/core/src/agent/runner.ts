import { randomUUID } from "crypto";
import type {
  AgentEvent,
  AssistantMessage,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentSettings, AttachmentDTO } from "@smithers/shared";
import type { ToolOutput } from "../tools";
import { ToolRunner } from "../tools";

export type AgentSecrets = {
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
};

export type CustomToolHandler = (args: any) => Promise<ToolOutput>;
export type CustomToolRegistry = Map<string, CustomToolHandler>;

export type AppCapabilities = {
  listWorkflows: () => Promise<Array<{ path: string; name?: string; description?: string }>>;
  runWorkflow: (params: { workflowPath: string; input: any; attachToSessionId?: string }) => Promise<string>;
  getSettings: () => any;
  setSettings: (patch: any) => any;
  listRuns: (status?: string) => Promise<any[]>;
};

export type AgentRunOptions = {
  text: string;
  attachments?: AttachmentDTO[];
  toolRunner: ToolRunner;
  history?: Message[];
  settings?: AgentSettings;
  secrets?: AgentSecrets;
  customTools?: CustomToolRegistry;
  appCapabilities?: AppCapabilities;
  signal?: AbortSignal;
};

type BuiltinToolCommand =
  | { kind: "read"; path: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "edit"; path: string; patch: string }
  | { kind: "bash"; command: string };

type ToolCommand = BuiltinToolCommand | { kind: "custom"; name: string; args: any };

type LlmUsage = {
  input: number;
  output: number;
  totalTokens: number;
};

type LlmConfig = {
  provider: "openai" | "anthropic";
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
};

type LlmToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

const MAX_TOOL_ROUNDS = 20;

function buildToolDefs(hasAppCapabilities: boolean): ToolDef[] {
  const defs: ToolDef[] = [
    {
      name: "read_file",
      description: "Read the contents of a file at the given path",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "File path to read" } },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Create or overwrite a file with the given content",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "edit_file",
      description: "Apply a unified diff patch to an existing file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to edit" },
          patch: { type: "string", description: "Unified diff patch to apply" },
        },
        required: ["path", "patch"],
      },
    },
    {
      name: "bash",
      description: "Run a shell command and return stdout/stderr",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string", description: "Shell command to execute" } },
        required: ["command"],
      },
    },
    {
      name: "create_workflow",
      description: "Create a new Smithers workflow template in the workflows/ directory. Uses a standard scaffold and picks a non-conflicting filename.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Workflow name (e.g. hello-world). Defaults to new-workflow." },
        },
      },
    },
  ];

  if (hasAppCapabilities) {
    defs.push(
      {
        name: "list_workflows",
        description: "List all available Smithers workflows in the workspace",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "run_workflow",
        description: "Run a Smithers workflow with the given input",
        inputSchema: {
          type: "object",
          properties: {
            workflowPath: { type: "string", description: "Path to the workflow .tsx file" },
            input: { type: "object", description: "JSON input for the workflow" },
          },
          required: ["workflowPath", "input"],
        },
      },
      {
        name: "get_settings",
        description: "Get the current Smithers app settings (provider, model, temperature, etc.)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "update_settings",
        description: "Update Smithers app settings",
        inputSchema: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["openai", "anthropic"], description: "AI provider" },
            model: { type: "string", description: "Model name" },
            temperature: { type: "number", description: "Temperature (0-2)" },
            maxTokens: { type: "number", description: "Max tokens" },
            allowNetwork: { type: "boolean", description: "Allow network access for bash" },
          },
        },
      },
      {
        name: "list_runs",
        description: "List Smithers workflow runs",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "finished", "failed", "all"], description: "Filter by status" },
          },
        },
      },
    );
  }

  return defs;
}

async function executeAgentTool(
  name: string,
  args: Record<string, any>,
  toolRunner: ToolRunner,
  appCapabilities?: AppCapabilities,
  customTools?: CustomToolRegistry,
): Promise<ToolOutput> {
  switch (name) {
    case "read_file":
      return toolRunner.read(args.path);
    case "write_file":
      return toolRunner.write(args.path, args.content);
    case "edit_file":
      return toolRunner.edit(args.path, args.patch);
    case "bash":
      return toolRunner.bash(args.command);
    case "list_workflows": {
      if (!appCapabilities) throw new Error("App capabilities not available");
      const workflows = await appCapabilities.listWorkflows();
      return { output: JSON.stringify(workflows, null, 2) };
    }
    case "run_workflow": {
      if (!appCapabilities) throw new Error("App capabilities not available");
      const runId = await appCapabilities.runWorkflow({
        workflowPath: args.workflowPath,
        input: args.input ?? {},
      });
      return { output: `Workflow started. Run ID: ${runId}` };
    }
    case "get_settings": {
      if (!appCapabilities) throw new Error("App capabilities not available");
      const settings = appCapabilities.getSettings();
      return { output: JSON.stringify(settings, null, 2) };
    }
    case "update_settings": {
      if (!appCapabilities) throw new Error("App capabilities not available");
      const patch: any = {};
      if (args.provider || args.model || args.temperature !== undefined || args.maxTokens !== undefined) {
        patch.agent = {} as any;
        if (args.provider) patch.agent.provider = args.provider;
        if (args.model) patch.agent.model = args.model;
        if (args.temperature !== undefined) patch.agent.temperature = args.temperature;
        if (args.maxTokens !== undefined) patch.agent.maxTokens = args.maxTokens;
      }
      if (args.allowNetwork !== undefined) {
        patch.smithers = { allowNetwork: args.allowNetwork };
      }
      const updated = appCapabilities.setSettings(patch);
      return { output: JSON.stringify(updated, null, 2) };
    }
    case "list_runs": {
      if (!appCapabilities) throw new Error("App capabilities not available");
      const runs = await appCapabilities.listRuns(args.status);
      return { output: JSON.stringify(runs, null, 2) };
    }
    case "create_workflow": {
      const name = sanitizeName(String(args.name ?? "new-workflow"));
      const filePath = await resolveWorkflowTemplatePath(toolRunner, name);
      const source = buildWorkflowTemplateSource(name);
      await toolRunner.write(filePath, source);
      return { output: JSON.stringify({ ok: true, path: filePath, name }, null, 2) };
    }
    default: {
      const handler = customTools?.get(name);
      if (handler) return handler(args);
      throw new Error(`Unknown tool: ${name}`);
    }
  }
}

export async function* runAgentTurn(opts: AgentRunOptions): AsyncIterable<AgentEvent> {
  const now = Date.now();
  const userMessage = buildUserMessage(opts.text, opts.attachments ?? [], now);
  const history = Array.isArray(opts.history) ? opts.history : [];
  const messages: Message[] = [...history, userMessage];

  yield { type: "agent_start" };
  yield { type: "turn_start" };
  yield { type: "message_start", message: userMessage };
  yield { type: "message_end", message: userMessage };

  if (opts.signal?.aborted) {
    yield { type: "agent_end", messages };
    return;
  }

  const command = parseToolCommand(opts.text, opts.customTools);
  if (command) {
    const toolCallId = randomUUID();
    const toolCall: ToolCall = {
      type: "toolCall",
      id: toolCallId,
      name: command.kind === "custom" ? command.name : command.kind,
      arguments: toolArgsFromCommand(command),
    };

    const assistantMessage = createAssistantMessage([toolCall]);
    messages.push(assistantMessage);

    yield { type: "message_start", message: assistantMessage };
    yield { type: "message_end", message: assistantMessage };

    yield {
      type: "tool_execution_start",
      toolCallId,
      toolName: toolCall.name,
      args: toolCall.arguments,
    };

    let toolResult: ToolResultMessage;

    try {
      const output = await runToolCommand(opts.toolRunner, command, opts.customTools);
      toolResult = {
        role: "toolResult",
        toolCallId,
        toolName: toolCall.name,
        content: [{ type: "text", text: output.output }],
        details: output.details,
        isError: false,
        timestamp: Date.now(),
      };
    } catch (err) {
      toolResult = {
        role: "toolResult",
        toolCallId,
        toolName: toolCall.name,
        content: [{ type: "text", text: String(err) }],
        details: { error: String(err) },
        isError: true,
        timestamp: Date.now(),
      };
    }

    yield {
      type: "tool_execution_end",
      toolCallId,
      toolName: toolCall.name,
      result: toolResult as any,
      isError: toolResult.isError,
    };

    messages.push(toolResult);
    yield { type: "message_start", message: toolResult };
    yield { type: "message_end", message: toolResult };

    yield { type: "turn_end", message: assistantMessage, toolResults: [toolResult] };
    yield { type: "agent_end", messages };
    return;
  }

  const workflowTemplate = detectWorkflowTemplateRequest(opts.text);
  if (workflowTemplate) {
    const filePath = await resolveWorkflowTemplatePath(opts.toolRunner, workflowTemplate.name);
    const workflowSource = buildWorkflowTemplateSource(workflowTemplate.name);
    await opts.toolRunner.write(filePath, workflowSource);
    const assistantText =
      `Created workflow at ${filePath}.\n` +
      `Run it via @workflow(${filePath}) input={"name":"Ada"} or the Run Workflow button.`;
    const { finalMessage, events } = streamAssistantMessage(assistantText, {
      provider: "local",
      model: "smithers-local",
      stopReason: "stop",
    });
    for (const event of events) {
      yield event;
    }
    messages.push(finalMessage);
    yield { type: "turn_end", message: finalMessage, toolResults: [] };
    yield { type: "agent_end", messages };
    return;
  }

  const config = resolveAgentConfig(opts.settings, opts.secrets);
  if (!config) {
    const assistantText = "No API key is configured. Open Settings → API Keys to add one.";
    const { finalMessage, events } = streamAssistantMessage(assistantText, {
      provider: "local",
      model: "smithers-local",
      stopReason: "error",
    });
    for (const event of events) {
      yield event;
    }
    messages.push(finalMessage);
    yield { type: "turn_end", message: finalMessage, toolResults: [] };
    yield { type: "agent_end", messages };
    return;
  }

  const toolDefs = buildToolDefs(Boolean(opts.appCapabilities));
  const llmMessages = buildProviderMessages(messages, config.systemPrompt);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (opts.signal?.aborted) break;

    const partial = createAssistantMessage([{ type: "text", text: "" }], {
      provider: config.provider,
      model: config.model,
      stopReason: "stop",
    });

    yield { type: "message_start", message: partial };
    yield {
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "text_start", contentIndex: 0, partial },
    };

    let fullText = "";
    let usage: LlmUsage | null = null;
    let stopReason: AssistantMessage["stopReason"] = "stop";
    let toolCalls: LlmToolCall[] = [];

    try {
      const result = streamLlmResponse(config, llmMessages, toolDefs, opts.signal);
      for await (const delta of result.stream) {
        if (opts.signal?.aborted) {
          stopReason = "aborted" as AssistantMessage["stopReason"];
          break;
        }
        if (!delta) continue;
        fullText += delta;
        const content = partial.content[0] as TextContent;
        content.text = fullText;
        yield {
          type: "message_update",
          message: { ...partial, content: [...partial.content] },
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial },
        };
      }
      usage = result.getUsage();
      stopReason = mapStopReason(result.getStopReason()) ?? stopReason;
      toolCalls = result.getToolCalls();
    } catch (err) {
      if (opts.signal?.aborted) {
        const abortedMessage = createAssistantMessage([{ type: "text", text: fullText }], {
          provider: config.provider,
          model: config.model,
          stopReason: "aborted" as AssistantMessage["stopReason"],
          usage: buildUsage(usage),
        });
        yield {
          type: "message_update",
          message: abortedMessage,
          assistantMessageEvent: { type: "text_end", contentIndex: 0, content: fullText, partial: abortedMessage },
        };
        yield { type: "message_end", message: abortedMessage };
        messages.push(abortedMessage);
        yield { type: "turn_end", message: abortedMessage, toolResults: [] };
        yield { type: "agent_end", messages };
        return;
      }
      const errorText = `LLM error: ${String(err)}`;
      const errorMessage = createAssistantMessage([{ type: "text", text: errorText }], {
        provider: config.provider,
        model: config.model,
        stopReason: "error",
        errorMessage: String(err),
      });
      yield {
        type: "message_update",
        message: errorMessage,
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: errorText, partial: errorMessage },
      };
      yield { type: "message_end", message: errorMessage };
      messages.push(errorMessage);
      yield { type: "turn_end", message: errorMessage, toolResults: [] };
      yield { type: "agent_end", messages };
      return;
    }

    if (stopReason === "toolUse" && toolCalls.length > 0) {
      const finalUsage = buildUsage(usage);
      const assistantContent: AssistantMessage["content"] = [];
      if (fullText) {
        assistantContent.push({ type: "text", text: fullText });
      }
      for (const tc of toolCalls) {
        assistantContent.push({
          type: "toolCall",
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
      const assistantMessage = createAssistantMessage(assistantContent, {
        provider: config.provider,
        model: config.model,
        stopReason: "toolUse",
        usage: finalUsage,
      });

      yield {
        type: "message_update",
        message: assistantMessage,
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: fullText, partial: assistantMessage },
      };
      yield { type: "message_end", message: assistantMessage };
      messages.push(assistantMessage);

      if (config.provider === "openai") {
        llmMessages.push({
          role: "assistant",
          content: fullText || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else {
        const anthropicContent: any[] = [];
        if (fullText) anthropicContent.push({ type: "text", text: fullText });
        for (const tc of toolCalls) {
          anthropicContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
        llmMessages.push({ role: "assistant", content: anthropicContent });
      }

      const toolResults: ToolResultMessage[] = [];
      const anthropicToolResults: any[] = [];

      for (const tc of toolCalls) {
        yield {
          type: "tool_execution_start",
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.arguments,
        };

        let output: ToolOutput;
        let isError = false;
        try {
          output = await executeAgentTool(tc.name, tc.arguments, opts.toolRunner, opts.appCapabilities, opts.customTools);
        } catch (err) {
          output = { output: String(err) };
          isError = true;
        }

        const toolResult: ToolResultMessage = {
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: output.output }],
          details: output.details,
          isError,
          timestamp: Date.now(),
        };

        yield {
          type: "tool_execution_end",
          toolCallId: tc.id,
          toolName: tc.name,
          result: toolResult as any,
          isError,
        };

        messages.push(toolResult);
        yield { type: "message_start", message: toolResult };
        yield { type: "message_end", message: toolResult };

        toolResults.push(toolResult);

        if (config.provider === "openai") {
          llmMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: output.output,
          });
        } else {
          anthropicToolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: output.output,
            is_error: isError,
          });
        }
      }

      if (config.provider === "anthropic" && anthropicToolResults.length > 0) {
        llmMessages.push({ role: "user", content: anthropicToolResults });
      }

      continue;
    }

    const finalUsage = buildUsage(usage);
    const finalMessage = createAssistantMessage([{ type: "text", text: fullText }], {
      provider: config.provider,
      model: config.model,
      stopReason,
      usage: finalUsage,
    });

    yield {
      type: "message_update",
      message: finalMessage,
      assistantMessageEvent: { type: "text_end", contentIndex: 0, content: fullText, partial: finalMessage },
    };
    yield { type: "message_end", message: finalMessage };

    messages.push(finalMessage);
    yield { type: "turn_end", message: finalMessage, toolResults: [] };
    yield { type: "agent_end", messages };
    return;
  }

  const limitMessage = createAssistantMessage(
    [{ type: "text", text: "Reached maximum tool use rounds. Stopping." }],
    { provider: config.provider, model: config.model, stopReason: "stop" },
  );
  yield { type: "message_start", message: limitMessage };
  yield { type: "message_end", message: limitMessage };
  messages.push(limitMessage);
  yield { type: "turn_end", message: limitMessage, toolResults: [] };
  yield { type: "agent_end", messages };
}

function buildUserMessage(text: string, attachments: AttachmentDTO[], timestamp: number): UserMessage & { attachments?: AttachmentDTO[] } {
  const content: TextContent[] = [{ type: "text", text }];

  for (const attachment of attachments) {
    if (attachment.type === "image") {
      content.push({
        type: "image",
        data: attachment.content,
        mimeType: attachment.mimeType,
      } as any);
    } else if (attachment.type === "document" && attachment.extractedText) {
      content.push({
        type: "text",
        text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}`,
        isDocument: true,
      } as any);
    }
  }

  return {
    role: "user",
    content,
    timestamp,
    attachments: attachments.length ? attachments : undefined,
  };
}

function createAssistantMessage(content: AssistantMessage["content"], override?: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "local",
    model: "smithers-local",
    usage: buildUsage(null),
    stopReason: "stop",
    timestamp: Date.now(),
    ...override,
  };
}

function streamAssistantMessage(
  text: string,
  override?: Partial<AssistantMessage>,
): {
  finalMessage: AssistantMessage;
  events: AgentEvent[];
} {
  const chunks = chunkText(text, 24);
  const partial = createAssistantMessage([{ type: "text", text: "" }], override);

  const events: AgentEvent[] = [];
  events.push({ type: "message_start", message: partial });
  events.push({
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type: "text_start", contentIndex: 0, partial },
  });

  for (const chunk of chunks) {
    const content = partial.content[0] as TextContent;
    content.text += chunk;
    events.push({
      type: "message_update",
      message: { ...partial, content: [...partial.content] },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: chunk, partial },
    });
  }

  const finalMessage = createAssistantMessage([{ type: "text", text }], override);
  events.push({
    type: "message_update",
    message: finalMessage,
    assistantMessageEvent: { type: "text_end", contentIndex: 0, content: text, partial: finalMessage },
  });
  events.push({ type: "message_end", message: finalMessage });
  return { finalMessage, events };
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, size));
    remaining = remaining.slice(size);
  }
  return chunks.length ? chunks : [""];
}

function parseToolCommand(text: string, customTools?: CustomToolRegistry): ToolCommand | null {
  const trimmed = text.trim();
  const match = /^([!/])(\S+)\s*(.*)$/i.exec(trimmed);
  if (!match) return null;
  const name = match[2].toLowerCase();
  const body = (match[3] ?? "").trim();

  if (name === "read") {
    const path = body.trim();
    if (!path) return null;
    return { kind: "read", path };
  }

  if (name === "bash") {
    const cmd = body.trim();
    if (!cmd) return null;
    return { kind: "bash", command: cmd };
  }

  if (name === "write" || name === "edit") {
    const [firstLine, ...rest] = body.split("\n");
    const path = (firstLine ?? "").trim();
    if (!path) return null;
    const content = rest.join("\n");
    if (name === "write") return { kind: "write", path, content };
    return { kind: "edit", path, patch: content };
  }

  if (customTools && customTools.has(name)) {
    let args: any = {};
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === "object") {
          args = parsed;
        } else {
          args = { input: parsed };
        }
      } catch {
        args = { input: body };
      }
    }
    return { kind: "custom", name, args };
  }

  return null;
}

function toolArgsFromCommand(command: ToolCommand): Record<string, unknown> {
  switch (command.kind) {
    case "read":
      return { path: command.path };
    case "write":
      return { path: command.path, content: command.content };
    case "edit":
      return { path: command.path, patch: command.patch };
    case "bash":
      return { command: command.command };
    case "custom":
      return command.args ?? {};
  }
}

async function runToolCommand(toolRunner: ToolRunner, command: ToolCommand, customTools?: CustomToolRegistry) {
  switch (command.kind) {
    case "read":
      return toolRunner.read(command.path);
    case "write":
      return toolRunner.write(command.path, command.content);
    case "edit":
      return toolRunner.edit(command.path, command.patch);
    case "bash":
      return toolRunner.bash(command.command);
    case "custom": {
      const handler = customTools?.get(command.name);
      if (!handler) {
        throw new Error(`Unknown tool: ${command.name}`);
      }
      return handler(command.args);
    }
  }
}

function resolveAgentConfig(settings?: AgentSettings, secrets?: AgentSecrets): LlmConfig | null {
  const openaiKey = secrets?.openaiApiKey ?? null;
  const anthropicKey = secrets?.anthropicApiKey ?? null;

  const defaultModel = (prov: LlmConfig["provider"]) =>
    prov === "anthropic" ? "claude-3-5-sonnet-20241022" : "gpt-4o-mini";

  let provider: LlmConfig["provider"] = settings?.provider ?? "openai";
  const modelFromSettings = settings?.model?.trim();
  let model = modelFromSettings || defaultModel(provider);
  let apiKey = provider === "openai" ? openaiKey : anthropicKey;

  if (!apiKey) {
    if (provider === "openai" && anthropicKey) {
      provider = "anthropic";
      model = defaultModel(provider);
      apiKey = anthropicKey;
    } else if (provider === "anthropic" && openaiKey) {
      provider = "openai";
      model = defaultModel(provider);
      apiKey = openaiKey;
    }
  }

  if (!apiKey) return null;

  return {
    provider,
    model,
    apiKey,
    temperature: settings?.temperature,
    maxTokens: settings?.maxTokens,
    systemPrompt: settings?.systemPrompt,
  };
}

function buildProviderMessages(messages: Message[], systemPrompt?: string): Array<Record<string, any>> {
  const modelMessages: Array<Record<string, any>> = [];
  if (systemPrompt && systemPrompt.trim()) {
    modelMessages.push({ role: "system", content: systemPrompt.trim() });
  }

  for (const message of messages) {
    const converted = convertMessageToText(message);
    if (!converted) continue;
    modelMessages.push(converted);
  }
  return modelMessages;
}

function convertMessageToText(message: Message): { role: string; content: string } | null {
  if (!message || typeof message !== "object") return null;
  if ((message as any).role === "user") {
    const content = extractText(message);
    return { role: "user", content };
  }
  if ((message as any).role === "assistant") {
    const content = extractAssistantText(message as AssistantMessage);
    if (!content) return null;
    return { role: "assistant", content };
  }
  return null;
}

function extractText(message: Message): string {
  const content: any = (message as any).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (part.type === "text") return part.text;
        if (part.type === "image") return "[Image attachment]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractAssistantText(message: AssistantMessage): string {
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function streamLlmResponse(
  config: LlmConfig,
  messages: Array<Record<string, any>>,
  toolDefs?: ToolDef[],
  signal?: AbortSignal,
): {
  stream: AsyncIterable<string>;
  getUsage: () => LlmUsage | null;
  getStopReason: () => string | null;
  getToolCalls: () => LlmToolCall[];
} {
  if (config.provider === "anthropic") {
    return streamAnthropic(config, messages, toolDefs, signal);
  }
  return streamOpenAI(config, messages, toolDefs, signal);
}

function streamOpenAI(
  config: LlmConfig,
  messages: Array<Record<string, any>>,
  toolDefs?: ToolDef[],
  signal?: AbortSignal,
) {
  let usage: LlmUsage | null = null;
  let stopReason: string | null = null;
  const toolCallsByIndex = new Map<number, { id?: string; name?: string; args: string }>();
  let toolCalls: LlmToolCall[] = [];

  const openaiTools = toolDefs?.length
    ? toolDefs.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }))
    : undefined;

  const stream = (async function* () {
    const body: Record<string, any> = {
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (openaiTools) {
      body.tools = openaiTools;
      body.tool_choice = "auto";
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${errorText}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineBreak = buffer.indexOf("\n");
      while (lineBreak !== -1) {
        const line = buffer.slice(0, lineBreak).trim();
        buffer = buffer.slice(lineBreak + 1);
        lineBreak = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          toolCalls = [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({
              id: tc.id ?? randomUUID(),
              name: tc.name ?? "unknown",
              arguments: tryParseJson(tc.args) ?? {},
            }));
          return;
        }
        const payload = JSON.parse(data) as any;
        const delta = payload?.choices?.[0]?.delta?.content;
        if (delta) {
          yield delta as string;
        }
        const deltaToolCalls = payload?.choices?.[0]?.delta?.tool_calls;
        if (Array.isArray(deltaToolCalls)) {
          for (const tc of deltaToolCalls) {
            const idx = Number(tc.index ?? 0);
            const acc = toolCallsByIndex.get(idx) ?? { args: "" };
            if (tc.id) acc.id = tc.id;
            if (tc?.function?.name) acc.name = tc.function.name;
            if (typeof tc?.function?.arguments === "string") {
              acc.args += tc.function.arguments;
            }
            toolCallsByIndex.set(idx, acc);
          }
        }
        const finish = payload?.choices?.[0]?.finish_reason;
        if (finish) stopReason = finish;
        if (payload?.usage) {
          usage = {
            input: Number(payload.usage.prompt_tokens ?? 0),
            output: Number(payload.usage.completion_tokens ?? 0),
            totalTokens: Number(payload.usage.total_tokens ?? 0),
          };
        }
      }
    }

    toolCalls = [...toolCallsByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => ({
        id: tc.id ?? randomUUID(),
        name: tc.name ?? "unknown",
        arguments: tryParseJson(tc.args) ?? {},
      }));
  })();

  return {
    stream,
    getUsage: () => usage,
    getStopReason: () => stopReason,
    getToolCalls: () => toolCalls,
  };
}

function streamAnthropic(
  config: LlmConfig,
  messages: Array<Record<string, any>>,
  toolDefs?: ToolDef[],
  signal?: AbortSignal,
) {
  let usage: LlmUsage | null = null;
  let stopReason: string | null = null;
  const toolCallsByIndex = new Map<number, { id: string; name: string; json: string }>();
  let toolCalls: LlmToolCall[] = [];

  const anthropicTools = toolDefs?.length
    ? toolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }))
    : undefined;

  const stream = (async function* () {
    const body: Record<string, any> = {
      model: config.model,
      system: config.systemPrompt,
      messages: messages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({ role: msg.role, content: msg.content })),
      max_tokens: config.maxTokens ?? 1024,
      temperature: config.temperature,
      stream: true,
    };
    if (anthropicTools) {
      body.tools = anthropicTools;
      body.tool_choice = { type: "auto" };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`Anthropic error ${response.status}: ${errorText}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let eventType: string | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineBreak = buffer.indexOf("\n");
      while (lineBreak !== -1) {
        const line = buffer.slice(0, lineBreak).trimEnd();
        buffer = buffer.slice(lineBreak + 1);
        lineBreak = buffer.indexOf("\n");
        if (!line) {
          eventType = null;
          continue;
        }
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          toolCalls = [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({
              id: tc.id,
              name: tc.name,
              arguments: tryParseJson(tc.json) ?? {},
            }));
          return;
        }
        const payload = JSON.parse(data) as any;
        if (eventType === "message_start" && payload?.message?.usage) {
          usage = {
            input: Number(payload.message.usage.input_tokens ?? 0),
            output: Number(payload.message.usage.output_tokens ?? 0),
            totalTokens:
              Number(payload.message.usage.input_tokens ?? 0) +
              Number(payload.message.usage.output_tokens ?? 0),
          };
        }
        if (eventType === "content_block_start") {
          const idx = Number(payload?.index ?? 0);
          const block = payload?.content_block;
          if (block?.type === "tool_use") {
            toolCallsByIndex.set(idx, {
              id: String(block.id),
              name: String(block.name),
              json: "",
            });
          }
        }
        if (eventType === "content_block_delta") {
          const delta = payload?.delta;
          const textDelta = delta?.text;
          if (textDelta) {
            yield textDelta as string;
          }
          if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
            const idx = Number(payload?.index ?? 0);
            const acc = toolCallsByIndex.get(idx);
            if (acc) {
              acc.json += delta.partial_json;
            }
          }
        }
        if (eventType === "message_delta") {
          if (payload?.delta?.stop_reason) stopReason = payload.delta.stop_reason;
          if (payload?.usage) {
            usage = {
              input: Number(payload.usage.input_tokens ?? 0),
              output: Number(payload.usage.output_tokens ?? 0),
              totalTokens:
                Number(payload.usage.input_tokens ?? 0) + Number(payload.usage.output_tokens ?? 0),
            };
          }
        }
        if (eventType === "message_stop") {
          toolCalls = [...toolCallsByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({
              id: tc.id,
              name: tc.name,
              arguments: tryParseJson(tc.json) ?? {},
            }));
          return;
        }
      }
    }

    toolCalls = [...toolCallsByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => ({
        id: tc.id,
        name: tc.name,
        arguments: tryParseJson(tc.json) ?? {},
      }));
  })();

  return {
    stream,
    getUsage: () => usage,
    getStopReason: () => stopReason,
    getToolCalls: () => toolCalls,
  };
}

function buildUsage(usage: LlmUsage | null): AssistantMessage["usage"] {
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const totalTokens = usage?.totalTokens ?? input + output;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function mapStopReason(reason: string | null): AssistantMessage["stopReason"] | null {
  if (!reason) return null;
  switch (reason) {
    case "stop":
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "tool_use":
      return "toolUse";
    default:
      return "error";
  }
}

type WorkflowTemplateRequest = {
  name: string;
};

function detectWorkflowTemplateRequest(text: string): WorkflowTemplateRequest | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^([!/])(read|write|edit|bash)\b/i.test(trimmed)) return null;
  if (/@workflow\(/i.test(trimmed)) return null;
  const lowered = trimmed.toLowerCase();
  if (!lowered.includes("workflow")) return null;
  if (!/(make|create|generate|new)\b/.test(lowered)) return null;

  const nameMatch = trimmed.match(/workflow\s+(?:named|called)?\s*([a-z0-9-_]+)/i);
  const name = nameMatch ? nameMatch[1]!.trim() : "new-workflow";
  return { name: sanitizeName(name) };
}

function sanitizeName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "new-workflow";
}

async function resolveWorkflowTemplatePath(toolRunner: ToolRunner, name: string): Promise<string> {
  const base = `workflows/${name}.tsx`;
  try {
    await toolRunner.read(base);
    return `workflows/${name}-${Date.now()}.tsx`;
  } catch {
    return base;
  }
}

function buildWorkflowTemplateSource(name: string): string {
  const workflowName = sanitizeName(name);
  return `/** @jsxImportSource smithers */
import { smithers, Workflow, Task } from "smithers";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

const input = sqliteTable("input", {
  runId: text("run_id").primaryKey(),
  name: text("name").notNull(),
});

const output = sqliteTable(
  "output",
  {
    runId: text("run_id").notNull(),
    nodeId: text("node_id").notNull(),
    message: text("message").notNull(),
    length: integer("length").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.nodeId] }),
  }),
);

export const schema = { input, output };
export const db = drizzle("./workflows/${workflowName}.db", { schema });

export default smithers(db, (ctx) => (
  <Workflow name="${workflowName}">
    <Task id="hello" output={output}>
      {{
        message: \`Hello, \${ctx.input.name}!\`,
        length: ctx.input.name.length,
      }}
    </Task>
  </Workflow>
));
`;
}
