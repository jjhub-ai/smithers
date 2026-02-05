import type { BunPlugin } from "./types";
import type { SmithersService } from "../smithers/SmithersService";
import type { WorkspaceService } from "../workspace/WorkspaceService";
import type { ToolOutput } from "../tools";

export function createSmithersPlugin(deps: {
  smithers: SmithersService;
  workspace: WorkspaceService;
}): BunPlugin {
  return {
    id: "smithers",
    registerTools: (ctx) => {
      ctx.registerTool("smithers.listWorkflows", async (args: any): Promise<ToolOutput> => {
        const workflows = await deps.workspace.listWorkflows(args?.root);
        return { output: JSON.stringify({ workflows }, null, 2), details: { workflows } };
      });

      ctx.registerTool("smithers.runWorkflow", async (args: any): Promise<ToolOutput> => {
        const runId = await deps.smithers.runWorkflow({
          workflowPath: String(args?.workflowPath ?? ""),
          input: args?.input ?? {},
          attachToSessionId: args?.attachToSessionId,
        });
        return { output: JSON.stringify({ runId }, null, 2), details: { runId } };
      });

      ctx.registerTool("smithers.getRun", async (args: any): Promise<ToolOutput> => {
        const run = deps.smithers.getRun(String(args?.runId ?? ""));
        return { output: JSON.stringify(run, null, 2), details: run as any };
      });

      ctx.registerTool("smithers.approveNode", async (args: any): Promise<ToolOutput> => {
        await deps.smithers.approveNode(
          String(args?.runId ?? ""),
          String(args?.nodeId ?? ""),
          typeof args?.iteration === "number" ? args.iteration : 0,
          args?.note,
        );
        return { output: JSON.stringify({ ok: true }, null, 2), details: { ok: true } };
      });

      ctx.registerTool("smithers.denyNode", async (args: any): Promise<ToolOutput> => {
        await deps.smithers.denyNode(
          String(args?.runId ?? ""),
          String(args?.nodeId ?? ""),
          typeof args?.iteration === "number" ? args.iteration : 0,
          args?.note,
        );
        return { output: JSON.stringify({ ok: true }, null, 2), details: { ok: true } };
      });

      ctx.registerTool("smithers.cancelRun", async (args: any): Promise<ToolOutput> => {
        await deps.smithers.cancelRun(String(args?.runId ?? ""));
        return { output: JSON.stringify({ ok: true }, null, 2), details: { ok: true } };
      });

      ctx.registerTool("smithers.resumeRun", async (args: any): Promise<ToolOutput> => {
        await deps.smithers.resumeRun(String(args?.runId ?? ""));
        return { output: JSON.stringify({ ok: true }, null, 2), details: { ok: true } };
      });

      ctx.registerTool("smithers.getFrame", async (args: any): Promise<ToolOutput> => {
        const frame = deps.smithers.getFrame(String(args?.runId ?? ""), args?.frameNo);
        return { output: JSON.stringify(frame, null, 2), details: frame as any };
      });
    },
  };
}
