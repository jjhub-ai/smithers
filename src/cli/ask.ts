import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const DOC_EXTENSIONS = new Set([".md", ".mdx"]);

function collectDocs(dir: string, root: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectDocs(full, root));
      } else if (DOC_EXTENSIONS.has(extname(entry.name))) {
        try {
          const content = readFileSync(full, "utf8");
          results.push({ path: relative(root, full), content });
        } catch {}
      }
    }
  } catch {}
  return results;
}

export async function ask(question: string, cwd: string): Promise<void> {
  const docsDir = resolve(cwd, "docs");
  const docs = collectDocs(docsDir, docsDir);

  if (docs.length === 0) {
    process.stderr.write("No docs found in docs/ directory.\n");
    process.exit(1);
  }

  const docsContext = docs
    .map((d) => `--- ${d.path} ---\n${d.content}`)
    .join("\n\n");

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `You are a helpful assistant that answers questions about Smithers, a durable AI workflow orchestrator. Answer based on the following documentation. If the answer is not in the docs, say so.\n\n${docsContext}`,
    prompt: question,
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");
}
