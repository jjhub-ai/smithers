import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateAgentsTs } from "./agent-detection";

type InitOptions = {
  force?: boolean;
  rootDir?: string;
};

type InitResult = {
  rootDir: string;
  writtenFiles: string[];
  skippedFiles: string[];
  preservedPaths: string[];
};

type DependencyVersions = {
  smithersVersion: string;
  zodVersion: string;
  typescriptVersion: string;
  reactTypesVersion: string;
  reactDomTypesVersion: string;
  mdxTypesVersion: string;
};

type TemplateFile = {
  path: string;
  contents: string;
};

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function ensureParent(path: string) {
  ensureDir(dirname(path));
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

function readPackageVersion(path: string, fallback: string) {
  try {
    return String(readJson(path).version ?? fallback);
  } catch {
    return fallback;
  }
}

function readDependencyVersions(): DependencyVersions {
  const rootPackage = readJson(new URL("../../package.json", import.meta.url).pathname);
  const nodeModulesRoot = new URL("../../node_modules/", import.meta.url).pathname;

  return {
    smithersVersion: String(rootPackage.version ?? "0.0.0"),
    zodVersion: readPackageVersion(resolve(nodeModulesRoot, "zod", "package.json"), "4.0.0"),
    typescriptVersion: readPackageVersion(resolve(nodeModulesRoot, "typescript", "package.json"), "5.0.0"),
    reactTypesVersion: readPackageVersion(resolve(nodeModulesRoot, "@types", "react", "package.json"), "19.0.0"),
    reactDomTypesVersion: readPackageVersion(resolve(nodeModulesRoot, "@types", "react-dom", "package.json"), "19.0.0"),
    mdxTypesVersion: readPackageVersion(resolve(nodeModulesRoot, "@types", "mdx", "package.json"), "2.0.0"),
  };
}

function renderPackageJson(versions: DependencyVersions) {
  return JSON.stringify(
    {
      name: "smithers-workflows",
      private: true,
      type: "module",
      scripts: {
        typecheck: "tsc --noEmit",
        "workflow:list": "smithers workflow list",
        "workflow:run": "smithers workflow run",
        "workflow:implement": "smithers workflow implement",
      },
      dependencies: {
        "smithers-orchestrator": versions.smithersVersion,
        zod: versions.zodVersion,
      },
      devDependencies: {
        typescript: versions.typescriptVersion,
        "@types/react": versions.reactTypesVersion,
        "@types/react-dom": versions.reactDomTypesVersion,
        "@types/mdx": versions.mdxTypesVersion,
      },
    },
    null,
    2,
  ) + "\n";
}

function renderTsconfig() {
  return JSON.stringify(
    {
      compilerOptions: {
        lib: ["ESNext", "DOM", "DOM.Iterable"],
        target: "ESNext",
        module: "ESNext",
        moduleDetection: "force",
        jsx: "react-jsx",
        jsxImportSource: "smithers-orchestrator",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["./**/*"],
      exclude: ["./executions/**/*"],
    },
    null,
    2,
  ) + "\n";
}

function renderPrompts(): TemplateFile[] {
  return [
    {
      path: ".smithers/prompts/review.mdx",
      contents: [
        "# Review",
        "",
        "Reviewer: {props.reviewer}",
        "",
        "Review the following request and respond with a concise JSON object.",
        "",
        "REQUEST:",
        "{props.prompt}",
        "",
        "REQUIRED OUTPUT:",
        "{props.schema}",
        "",
      ].join("\n"),
    },
    {
      path: ".smithers/prompts/plan.mdx",
      contents: [
        "# Plan",
        "",
        "Create a practical implementation plan for the following request.",
        "",
        "REQUEST:",
        "{props.prompt}",
        "",
        "REQUIRED OUTPUT:",
        "{props.schema}",
        "",
      ].join("\n"),
    },
    {
      path: ".smithers/prompts/implement.mdx",
      contents: [
        "# Implement",
        "",
        "Carry out the following request in the current repository.",
        "",
        "REQUEST:",
        "{props.prompt}",
        "",
        "REQUIRED OUTPUT:",
        "{props.schema}",
        "",
      ].join("\n"),
    },
    {
      path: ".smithers/prompts/validate.mdx",
      contents: [
        "# Validate",
        "",
        "Validate the current repository state for the following request.",
        "",
        "REQUEST:",
        "{props.prompt}",
        "",
        "REQUIRED OUTPUT:",
        "{props.schema}",
        "",
      ].join("\n"),
    },
    {
      path: ".smithers/prompts/coverage.mdx",
      contents: [
        "# Improve Test Coverage",
        "",
        "Identify the highest-impact missing tests for this request and add them.",
        "",
        "REQUEST:",
        "{props.prompt}",
        "",
        "REQUIRED OUTPUT:",
        "{props.schema}",
        "",
      ].join("\n"),
    },
    {
      path: ".smithers/prompts/ticket.mdx",
      contents: [
        "# Ticket",
        "",
        "Implement the ticket or task described below.",
        "",
        "REQUEST:",
        "{props.prompt}",
        "",
        "REQUIRED OUTPUT:",
        "{props.schema}",
        "",
      ].join("\n"),
    },
  ];
}

function renderComponents(): TemplateFile[] {
  return [
    {
      path: ".smithers/components/Review.tsx",
      contents: [
        "// smithers-source: seeded",
        "/** @jsxImportSource smithers-orchestrator */",
        'import { Parallel, Task, type AgentLike } from "smithers-orchestrator";',
        'import { z } from "zod";',
        'import ReviewPrompt from "../prompts/review.mdx";',
        "",
        "const reviewIssueSchema = z.object({",
        '  severity: z.enum(["critical", "major", "minor", "nit"]),',
        "  title: z.string(),",
        "  file: z.string().nullable().default(null),",
        "  description: z.string(),",
        "});",
        "",
        "export const reviewOutputSchema = z.object({",
        "  reviewer: z.string(),",
        "  approved: z.boolean(),",
        "  feedback: z.string(),",
        "  issues: z.array(reviewIssueSchema).default([]),",
        "}).passthrough();",
        "",
        "type ReviewProps = {",
        "  idPrefix: string;",
        "  prompt: unknown;",
        "  agents: AgentLike[];",
        "};",
        "",
        "export function Review({ idPrefix, prompt, agents }: ReviewProps) {",
        '  const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);',
        "  return (",
        "    <Parallel>",
        "      {agents.map((agent, index) => (",
        "        <Task",
        "          key={`${idPrefix}:${index}`}",
        "          id={`${idPrefix}:${index}`}",
        "          output={reviewOutputSchema}",
        "          agent={agent}",
        "          continueOnFail",
        "        >",
        '          <ReviewPrompt reviewer={`reviewer-${index + 1}`} prompt={promptText} />',
        "        </Task>",
        "      ))}",
        "    </Parallel>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      path: ".smithers/components/ValidationLoop.tsx",
      contents: [
        "// smithers-source: seeded",
        "/** @jsxImportSource smithers-orchestrator */",
        'import { Sequence, Task, type AgentLike } from "smithers-orchestrator";',
        'import { z } from "zod";',
        'import ImplementPrompt from "../prompts/implement.mdx";',
        'import ValidatePrompt from "../prompts/validate.mdx";',
        'import { Review } from "./Review";',
        "",
        "export const implementOutputSchema = z.object({",
        "  summary: z.string(),",
        "  prompt: z.string().nullable().default(null),",
        "  filesChanged: z.array(z.string()).default([]),",
        "  allTestsPassing: z.boolean().default(true),",
        "}).passthrough();",
        "",
        "export const validateOutputSchema = z.object({",
        "  summary: z.string(),",
        "  allPassed: z.boolean().default(true),",
        "  failingSummary: z.string().nullable().default(null),",
        "}).passthrough();",
        "",
        "type ValidationLoopProps = {",
        "  idPrefix: string;",
        "  prompt: unknown;",
        "  implementAgents: AgentLike[];",
        "  reviewAgents: AgentLike[];",
        "  validateAgents?: AgentLike[];",
        "};",
        "",
        "export function ValidationLoop({",
        "  idPrefix,",
        "  prompt,",
        "  implementAgents,",
        "  reviewAgents,",
        "  validateAgents,",
        "}: ValidationLoopProps) {",
        "  const validationChain = validateAgents && validateAgents.length > 0",
        "    ? validateAgents",
        "    : implementAgents;",
        '  const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt ?? null);',
        "",
        "  return (",
        "    <Sequence>",
        "      <Task id={`${idPrefix}:implement`} output={implementOutputSchema} agent={implementAgents}>",
        "        <ImplementPrompt prompt={promptText} />",
        "      </Task>",
        "      <Task id={`${idPrefix}:validate`} output={validateOutputSchema} agent={validationChain}>",
        "        <ValidatePrompt prompt={promptText} />",
        "      </Task>",
        "      <Review idPrefix={`${idPrefix}:review`} prompt={promptText} agents={reviewAgents} />",
        "    </Sequence>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
    {
      path: ".smithers/components/CommandProbe.tsx",
      contents: [
        "// smithers-source: seeded",
        "/** @jsxImportSource smithers-orchestrator */",
        'import { Task } from "smithers-orchestrator";',
        'import { z } from "zod";',
        "",
        "export const commandProbeOutputSchema = z.object({",
        "  command: z.string(),",
        "  available: z.boolean(),",
        "}).passthrough();",
        "",
        "export function CommandProbe({ id, command }: { id: string; command: string }) {",
        "  return (",
        "    <Task id={id} output={commandProbeOutputSchema}>",
        "      {{ command, available: true }}",
        "    </Task>",
        "  );",
        "}",
        "",
      ].join("\n"),
    },
  ];
}

function renderWorkflowFile(
  id: string,
  displayName: string,
  body: string[],
) {
  return {
    path: `.smithers/workflows/${id}.tsx`,
    contents: [
      "// smithers-source: seeded",
      `// smithers-display-name: ${displayName}`,
      "/** @jsxImportSource smithers-orchestrator */",
      ...body,
      "",
    ].join("\n"),
  };
}

function renderWorkflows(): TemplateFile[] {
  const sharedImports = [
    'import { createSmithers } from "smithers-orchestrator";',
    'import { z } from "zod";',
    'import { pickAgent, roleChains } from "../agents";',
  ];

  return [
    renderWorkflowFile("implement", "Implement", [
      ...sharedImports,
      'import { ValidationLoop, implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";',
      'import { reviewOutputSchema } from "../components/Review";',
      "",
      "const { Workflow, smithers } = createSmithers({",
      "  implement: implementOutputSchema,",
      "  validate: validateOutputSchema,",
      "  review: reviewOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="implement">',
      "    <ValidationLoop",
      '      idPrefix="implement"',
      '      prompt={ctx.input.prompt ?? "Implement the requested change."}',
      "      implementAgents={roleChains.implement}",
      "      validateAgents={roleChains.validate}",
      "      reviewAgents={roleChains.review}",
      "    />",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("review", "Review", [
      ...sharedImports,
      'import { Review, reviewOutputSchema } from "../components/Review";',
      "",
      "const { Workflow, smithers } = createSmithers({",
      "  review: reviewOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="review">',
      "    <Review",
      '      idPrefix="review"',
      '      prompt={ctx.input.prompt ?? "Review the current repository changes."}',
      "      agents={roleChains.review}",
      "    />",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("plan", "Plan", [
      ...sharedImports,
      'import PlanPrompt from "../prompts/plan.mdx";',
      "",
      "const planOutputSchema = z.object({",
      "  summary: z.string(),",
      "  steps: z.array(z.string()).default([]),",
      "}).passthrough();",
      "",
      "const { Workflow, Task, smithers } = createSmithers({",
      "  plan: planOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="plan">',
      '    <Task id="plan" output={planOutputSchema} agent={pickAgent("plan")}>',
      '      <PlanPrompt prompt={ctx.input.prompt ?? "Create an implementation plan."} />',
      "    </Task>",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("ticket", "Ticket", [
      ...sharedImports,
      'import { ValidationLoop, implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";',
      'import { reviewOutputSchema } from "../components/Review";',
      "",
      "const { Workflow, smithers } = createSmithers({",
      "  implement: implementOutputSchema,",
      "  validate: validateOutputSchema,",
      "  review: reviewOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="ticket">',
      "    <ValidationLoop",
      '      idPrefix="ticket"',
      '      prompt={ctx.input.prompt ?? "Implement the provided ticket."}',
      "      implementAgents={roleChains.implement}",
      "      validateAgents={roleChains.validate}",
      "      reviewAgents={roleChains.review}",
      "    />",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("tickets", "Tickets", [
      ...sharedImports,
      "",
      "const ticketsOutputSchema = z.object({",
      "  summary: z.string(),",
      "  tickets: z.array(z.string()).default([]),",
      "}).passthrough();",
      "",
      "const { Workflow, Task, smithers } = createSmithers({",
      "  tickets: ticketsOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="tickets">',
      '    <Task id="tickets" output={ticketsOutputSchema} agent={pickAgent("plan")}>',
      "      {`Summarize and sequence the requested ticket batch.\\n\\nRequest: ${ctx.input.prompt ?? \"Process the available tickets.\"}`}",
      "    </Task>",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("ralph", "Ralph", [
      ...sharedImports,
      'import { ValidationLoop, implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";',
      'import { reviewOutputSchema } from "../components/Review";',
      "",
      "const { Workflow, smithers } = createSmithers({",
      "  implement: implementOutputSchema,",
      "  validate: validateOutputSchema,",
      "  review: reviewOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="ralph">',
      "    <ValidationLoop",
      '      idPrefix="ralph"',
      '      prompt={ctx.input.prompt ?? "Iterate until the request is complete."}',
      "      implementAgents={roleChains.implement}",
      "      validateAgents={roleChains.validate}",
      "      reviewAgents={roleChains.review}",
      "    />",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("improve-test-coverage", "Improve Test Coverage", [
      ...sharedImports,
      'import { ValidationLoop, implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";',
      'import { reviewOutputSchema } from "../components/Review";',
      "",
      "const { Workflow, smithers } = createSmithers({",
      "  implement: implementOutputSchema,",
      "  validate: validateOutputSchema,",
      "  review: reviewOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="improve-test-coverage">',
      "    <ValidationLoop",
      '      idPrefix="improve-test-coverage"',
      '      prompt={ctx.input.prompt ?? "Improve the test coverage for the current repository."}',
      "      implementAgents={roleChains.implement}",
      "      validateAgents={roleChains.validate}",
      "      reviewAgents={roleChains.review}",
      "    />",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("test-first", "Test First", [
      ...sharedImports,
      'import { ValidationLoop, implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";',
      'import { reviewOutputSchema } from "../components/Review";',
      "",
      "const { Workflow, smithers } = createSmithers({",
      "  implement: implementOutputSchema,",
      "  validate: validateOutputSchema,",
      "  review: reviewOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="test-first">',
      "    <ValidationLoop",
      '      idPrefix="test-first"',
      '      prompt={ctx.input.prompt ?? "Write or update tests before implementation."}',
      "      implementAgents={roleChains.implement}",
      "      validateAgents={roleChains.validate}",
      "      reviewAgents={roleChains.review}",
      "    />",
      "  </Workflow>",
      "));",
    ]),
    renderWorkflowFile("debug", "Debug", [
      ...sharedImports,
      'import { ValidationLoop, implementOutputSchema, validateOutputSchema } from "../components/ValidationLoop";',
      'import { reviewOutputSchema } from "../components/Review";',
      "",
      "const { Workflow, smithers } = createSmithers({",
      "  implement: implementOutputSchema,",
      "  validate: validateOutputSchema,",
      "  review: reviewOutputSchema,",
      "});",
      "",
      "export default smithers((ctx) => (",
      '  <Workflow name="debug">',
      "    <ValidationLoop",
      '      idPrefix="debug"',
      '      prompt={ctx.input.prompt ?? "Reproduce and fix the reported bug."}',
      "      implementAgents={roleChains.implement}",
      "      validateAgents={roleChains.validate}",
      "      reviewAgents={roleChains.review}",
      "    />",
      "  </Workflow>",
      "));",
    ]),
  ];
}

function renderTemplateFiles(versions: DependencyVersions, env: NodeJS.ProcessEnv): TemplateFile[] {
  return [
    {
      path: ".smithers/.gitignore",
      contents: ["node_modules/", "executions/", "*.db", "*.sqlite", "dist/", ".DS_Store", ""].join("\n"),
    },
    {
      path: ".smithers/package.json",
      contents: renderPackageJson(versions),
    },
    {
      path: ".smithers/tsconfig.json",
      contents: renderTsconfig(),
    },
    {
      path: ".smithers/bunfig.toml",
      contents: ['preload = ["./preload.ts"]', ""].join("\n"),
    },
    {
      path: ".smithers/preload.ts",
      contents: ['import { mdxPlugin } from "smithers-orchestrator";', "", "mdxPlugin();", ""].join("\n"),
    },
    {
      path: ".smithers/agents.ts",
      contents: generateAgentsTs(env),
    },
    {
      path: ".smithers/smithers.config.ts",
      contents: [
        "export const repoCommands = {",
        "  lint: null,",
        "  test: null,",
        "  coverage: null,",
        "} as const;",
        "",
        "export default { repoCommands };",
        "",
      ].join("\n"),
    },
    ...renderPrompts(),
    ...renderComponents(),
    ...renderWorkflows(),
    {
      path: ".smithers/tickets/.gitkeep",
      contents: "",
    },
  ];
}

export function initWorkflowPack(options: InitOptions = {}): InitResult {
  const rootDir = resolve(options.rootDir ?? process.cwd(), ".smithers");
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const preservedPaths: string[] = [];
  const versions = readDependencyVersions();
  const env = process.env;

  ensureDir(rootDir);
  ensureDir(resolve(rootDir, "prompts"));
  ensureDir(resolve(rootDir, "components"));
  ensureDir(resolve(rootDir, "workflows"));
  ensureDir(resolve(rootDir, "tickets"));

  const executionsDir = resolve(rootDir, "executions");
  if (existsSync(executionsDir)) {
    preservedPaths.push(executionsDir);
  } else {
    ensureDir(executionsDir);
  }

  for (const file of renderTemplateFiles(versions, env)) {
    const absolutePath = resolve(options.rootDir ?? process.cwd(), file.path);
    ensureParent(absolutePath);
    if (existsSync(absolutePath) && !options.force) {
      skippedFiles.push(absolutePath);
      continue;
    }
    writeFileSync(absolutePath, file.contents, "utf8");
    writtenFiles.push(absolutePath);
  }

  return {
    rootDir,
    writtenFiles,
    skippedFiles,
    preservedPaths,
  };
}
