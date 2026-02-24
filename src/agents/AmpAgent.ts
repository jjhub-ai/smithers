import {
  BaseCliAgent,
  pushFlag,
} from "./BaseCliAgent";
import type { BaseCliAgentOptions } from "./BaseCliAgent";

type AmpAgentOptions = BaseCliAgentOptions & {
  visibility?: "private" | "public" | "workspace" | "group";
  mcpConfig?: string;
  settingsFile?: string;
  logLevel?: "error" | "warn" | "info" | "debug" | "audit";
  logFile?: string;
  dangerouslyAllowAll?: boolean;
  ide?: boolean;
  jetbrains?: boolean;
};

export class AmpAgent extends BaseCliAgent {
  private readonly opts: AmpAgentOptions;

  constructor(opts: AmpAgentOptions = {}) {
    super(opts);
    this.opts = opts;
  }

  protected async buildCommand(params: {
    prompt: string;
    systemPrompt?: string;
    cwd: string;
    options: any;
  }) {
    const args: string[] = [];
    const yoloEnabled = this.opts.yolo ?? this.yolo;

    // Dangerous allow all (yolo mode) — must come before --execute
    if (this.opts.dangerouslyAllowAll || yoloEnabled) {
      args.push("--dangerously-allow-all");
    }

    // Model / mode
    pushFlag(args, "--model", this.opts.model ?? this.model);

    // Visibility for new threads
    pushFlag(args, "--visibility", this.opts.visibility);

    // MCP config
    pushFlag(args, "--mcp-config", this.opts.mcpConfig);

    // Settings file
    pushFlag(args, "--settings-file", this.opts.settingsFile);

    // Log level
    pushFlag(args, "--log-level", this.opts.logLevel);

    // Log file
    pushFlag(args, "--log-file", this.opts.logFile);

    // IDE integration — disable by default for headless execution
    args.push("--no-ide");
    args.push("--no-jetbrains");

    // Color handling
    args.push("--no-color");

    // Archive thread after execution to keep things clean
    args.push("--archive");

    if (this.extraArgs?.length) args.push(...this.extraArgs);

    // Build prompt with system prompt prepended
    const systemPrefix = params.systemPrompt
      ? `${params.systemPrompt}\n\n`
      : "";
    const fullPrompt = `${systemPrefix}${params.prompt ?? ""}`;

    // Execute mode with prompt as argument
    args.push("--execute", fullPrompt);

    return {
      command: "amp",
      args,
      outputFormat: "text" as const,
    };
  }
}
