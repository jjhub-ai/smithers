/**
 * <DocSync> — Compare docs to code → find discrepancies → fix → PR.
 *
 * Pattern: Audit docs against source of truth → auto-fix → open PR.
 * Use cases: API docs sync, README updates, changelog generation, JSDoc sync.
 */
import { createSmithers, Sequence, Parallel } from "smithers-orchestrator";
import { ToolLoopAgent as Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, write, edit, bash, grep } from "smithers-orchestrator/tools";
import { z } from "zod";

const auditSchema = z.object({
  discrepancies: z.array(z.object({
    docFile: z.string(),
    codeFile: z.string(),
    issue: z.enum(["outdated-api", "missing-param", "wrong-example", "missing-doc", "stale-reference"]),
    description: z.string(),
    severity: z.enum(["critical", "warning", "info"]),
  })),
  totalDocsChecked: z.number(),
});

const fixSchema = z.object({
  file: z.string(),
  changes: z.string(),
  status: z.enum(["fixed", "needs-human", "skipped"]),
});

const prSchema = z.object({
  branch: z.string(),
  prUrl: z.string().optional(),
  filesChanged: z.number(),
  summary: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  audit: auditSchema,
  fix: fixSchema,
  pr: prSchema,
});

const auditor = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep, bash },
  instructions: `You are a docs auditor. Compare documentation files against the actual
source code. Check that API signatures, parameter names, return types, and examples
all match the current implementation. Be thorough and precise.`,
});

const fixer = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, edit },
  instructions: `You are a technical writer. Fix documentation to match the actual code.
Preserve the existing style and tone. Only fix factual inaccuracies — don't rewrite
for style. Make minimal, surgical edits.`,
});

const prAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { bash },
  instructions: `You are a git/GitHub agent. Create a branch, commit changes, and open a PR.
Write clear commit messages and PR descriptions.`,
});

export default smithers((ctx) => {
  const audit = ctx.outputMaybe("audit", { nodeId: "audit" });
  const fixes = ctx.outputs.fix ?? [];
  const fixableDiscrepancies = audit?.discrepancies?.filter((d) => d.severity !== "info") ?? [];

  return (
    <Workflow name="doc-sync">
      <Sequence>
        <Task id="audit" output={outputs.audit} agent={auditor}>
          {`Audit documentation against source code:

Docs directory: ${ctx.input.docsDir ?? "docs/"}
Source directory: ${ctx.input.srcDir ?? "src/"}
Doc format: ${ctx.input.format ?? "mdx"}

For each doc file:
1. Find the corresponding source code
2. Verify all API signatures match
3. Check that examples are valid
4. Flag any stale references`}
        </Task>

        {/* Fix discrepancies in parallel */}
        {fixableDiscrepancies.length > 0 && (
          <Parallel maxConcurrency={3}>
            {fixableDiscrepancies.map((d, i) => (
              <Task
                key={`${d.docFile}-${i}`}
                id={`fix-${i}`}
                output={outputs.fix}
                agent={fixer}
                continueOnFail
              >
                {`Fix this documentation discrepancy:
File: ${d.docFile}
Issue: ${d.issue} — ${d.description}
Reference code: ${d.codeFile}

Make minimal edits to fix the factual error.`}
              </Task>
            ))}
          </Parallel>
        )}

        {/* Open PR if fixes were made */}
        <Task
          id="pr"
          output={outputs.pr}
          agent={prAgent}
          skipIf={fixes.filter((f) => f.status === "fixed").length === 0}
        >
          {`Create a PR with the doc fixes:
1. git checkout -b docs/auto-sync-${Date.now()}
2. git add ${fixes.filter((f) => f.status === "fixed").map((f) => f.file).join(" ")}
3. git commit -m "docs: sync documentation with source code"
4. git push -u origin HEAD
5. gh pr create --title "docs: auto-sync documentation" --body "Fixes ${fixes.filter((f) => f.status === "fixed").length} documentation discrepancies found by automated audit"`}
        </Task>
      </Sequence>
    </Workflow>
  );
});
