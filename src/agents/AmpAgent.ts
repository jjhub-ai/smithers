import {
  BaseCliAgent,
  pushFlag,
} from "./BaseCliAgent";
import type { BaseCliAgentOptions } from "./BaseCliAgent";

/**
 * Configuration options for the AmpAgent.
 */
export type AmpAgentOptions = BaseCliAgentOptions & {
  /** Visibility setting for the new thread (e.g., private, public) */
  visibility?: "private" | "public" | "workspace" | "group";
  
  /** Path to a specific MCP configuration file */
  mcpConfig?: string;
  
  /** Path to a specific settings file */
  settingsFile?: string;
  
  /** Logging severity level */
  logLevel?: "error" | "warn" | "info" | "debug" | "audit";
  
  /** File path to write logs to */
  logFile?: string;
  
  /** 
   * If true, dangerously allows all commands without asking for permission.
   * Equivalent to yolo mode but explicit.
   */
  dangerouslyAllowAll?: boolean;
  
  /** Whether to enable IDE integrations (disabled by default in AmpAgent) */
  ide?: boolean;
  
  /** Whether to enable JetBrains IDE integration */
  jetbrains?: boolean;
};

/**
 * Agent implementation that wraps the 'amp' CLI executable.
 * It translates generation requests into CLI arguments and executes the process.
 */
export class AmpAgent extends BaseCliAgent {
  private readonly opts: AmpAgentOptions;

  /**
   * Initializes a new AmpAgent with the given options.
   * 
   * @param opts - Configuration options for the agent
   */
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
