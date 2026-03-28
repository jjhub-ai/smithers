/** @jsxImportSource smithers */
import { createSmithers, Task, Workflow } from "../src";
import { ClaudeCodeAgent } from "../src/agents/ClaudeCodeAgent";
import { AmpAgent } from "../src/agents/AmpAgent";
import { GeminiAgent } from "../src/agents/GeminiAgent";
import { z } from "zod";

const Output = z.object({
  answer: z.string(),
});

const { smithers, outputs } = createSmithers(
  {
    result: Output,
  },
  {
    dbPath: "./workflows/real-agent-trace-check.db",
    journalMode: "DELETE",
  },
);

function buildAgent(kind: string) {
  switch (kind) {
    case "claude":
      return new ClaudeCodeAgent({
        yolo: true,
        outputFormat: "stream-json",
        maxOutputBytes: 512 * 1024,
      });
    case "amp":
      return new AmpAgent({
        yolo: true,
        maxOutputBytes: 512 * 1024,
      });
    case "gemini":
      return new GeminiAgent({
        approvalMode: "yolo",
        outputFormat: "stream-json",
        maxOutputBytes: 512 * 1024,
      });
    default:
      throw new Error(`Unsupported agent kind: ${kind}`);
  }
}

export default smithers((ctx) => {
  const agentKind =
    typeof ctx.input.agent === "string" ? ctx.input.agent : "claude";

  return (
    <Workflow name="real-agent-trace-check">
      <Task
        id={`${agentKind}-trace`}
        output={outputs.result}
        agent={buildAgent(agentKind)}
        retries={0}
        timeoutMs={120000}
      >
        {`Respond briefly. State which agent you are, then end with JSON matching the required schema.`}
      </Task>
    </Workflow>
  );
});
