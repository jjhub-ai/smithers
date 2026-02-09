# Design Agent Prompt: Smithers Desktop UI

You are a design agent tasked with creating a detailed specification for a desktop application that combines a conversational AI agent with workflow orchestration capabilities. This document provides all the context you need to design the system.

---

## Executive Summary

**Goal:** Build a desktop application using Electrobun that:
1. Provides a chat interface for talking to a normal AI coding agent (powered by pi-mono)
2. Integrates with the Smithers workflow orchestration framework via a pi-mono plugin
3. Allows users to run, monitor, and control Smithers workflow scripts from the UI
4. Provides real-time visualization of workflow execution

**Tech Stack:**
- **Desktop Framework:** Electrobun (Bun runtime + native webview)
- **Agent Framework:** pi-mono (@mariozechner/pi-coding-agent, pi-agent-core, pi-web-ui)
- **Workflow Engine:** Smithers (JSX-based workflow graphs, SQLite persistence)
- **Frontend:** Web technologies in Electrobun webview (likely using pi-web-ui components)

---

## Part 1: Electrobun Framework Context

Electrobun is a desktop application framework for TypeScript that uses:
- **Bun** as the main process runtime (instead of Node.js like Electron)
- **Native system webview** for rendering (not bundled Chromium)
- **Native bindings** in C/ObjC/Zig for OS features
- **~14MB bundle size**, ~50ms startup time

### Architecture Model

```
┌─────────────────────────────────────────────────────┐
│                   Native Shell                       │
│   (Window management, menus, system integration)     │
└─────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────┐
│               Bun Process (Main)                     │
│   - TypeScript runtime                               │
│   - Business logic, file I/O, subprocess mgmt       │
│   - RPC server for webview communication            │
└─────────────────────────────────────────────────────┘
                          │ RPC (typed, async)
┌─────────────────────────┴───────────────────────────┐
│              Webview (Browser Process)               │
│   - HTML/CSS/JS UI                                   │
│   - Can call Bun functions via RPC                  │
│   - Can expose functions for Bun to call            │
└─────────────────────────────────────────────────────┘
```

### Key Electrobun APIs

**BrowserWindow** - Create native windows:
```typescript
import { BrowserWindow, BrowserView } from "electrobun/bun";

const win = new BrowserWindow({
  title: "Smithers",
  frame: { width: 1400, height: 900 },
  url: "views://main/index.html",  // Bundled assets
  rpc: myRpc,  // Typed RPC between processes
});
```

**RPC System** - Type-safe communication:
```typescript
// Shared types (src/shared/types.ts)
export type AppRPCType = {
  bun: RPCSchema<{
    requests: {
      runWorkflow: { params: { path: string; input: any }; response: { runId: string } };
      approveNode: { params: { runId: string; nodeId: string }; response: void };
    };
    messages: {
      workflowEvent: { event: SmithersEvent };
    };
  }>;
  webview: RPCSchema<{
    requests: {
      getAgentState: { params: {}; response: AgentState };
    };
    messages: {
      streamChunk: { text: string };
    };
  }>;
};

// Bun side defines handlers, calls webview methods
// Webview side defines handlers, calls bun methods
```

**Bundled Assets** - Use `views://` scheme:
```typescript
url: "views://main/index.html"  // Maps to bundled view
```

---

## Part 2: Pi-Mono Framework Context

Pi-mono is a minimal, extensible AI agent toolkit. Key packages:

### @mariozechner/pi-coding-agent
The terminal coding agent CLI with:
- 4 core tools: read, write, edit, bash
- Extension system for custom tools, commands, UI
- Session management with branching
- Skills (markdown files that guide the agent)
- Multiple modes: interactive, JSON, RPC, SDK

**SDK Usage (for embedding):**
```typescript
import { 
  AuthStorage, 
  createAgentSession, 
  ModelRegistry, 
  SessionManager 
} from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: new AuthStorage(),
  modelRegistry: new ModelRegistry(authStorage),
});

await session.prompt("What files are in the current directory?");
```

**RPC Mode** - For non-Node integrations:
```bash
pi --mode rpc  # Communicate via stdin/stdout JSON
```

### @mariozechner/pi-agent-core
Stateful agent loop with:
- Tool execution and streaming
- Event system (agent_start, message_update, tool_execution_*, etc.)
- Message queue (steering and follow-up)
- Abort/continue support

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
    thinkingLevel: "off",
    messages: [],
    tools: [],
  },
  convertToLlm: defaultConvertToLlm,
});

// Subscribe to events
agent.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
    case "message_update":  // Streaming chunks
    case "tool_execution_start":
    case "tool_execution_end":
    case "agent_end":
      break;
  }
});

// Send message
await agent.prompt("Hello!");
```

### @mariozechner/pi-web-ui
Web components for AI chat interfaces:

```typescript
import { 
  ChatPanel, 
  AgentInterface,
  AppStorage, 
  IndexedDBStorageBackend,
  SettingsStore,
  ProviderKeysStore,
  SessionsStore,
} from "@mariozechner/pi-web-ui";
import "@mariozechner/pi-web-ui/app.css";

// Storage setup
const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();

const backend = new IndexedDBStorageBackend({
  dbName: "smithers-app",
  version: 1,
  stores: [
    settings.getConfig(),
    providerKeys.getConfig(), 
    sessions.getConfig(),
    SessionsStore.getMetadataConfig(),
  ],
});

// Create chat panel
const chatPanel = new ChatPanel();
await chatPanel.setAgent(agent, {
  onApiKeyRequired: (provider) => ApiKeyPromptDialog.prompt(provider),
});

document.body.appendChild(chatPanel);
```

**Architecture:**
```
┌─────────────────────────────────────────────────────┐
│                    ChatPanel                         │
│  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │   AgentInterface    │  │   ArtifactsPanel    │   │
│  │  (messages, input)  │  │  (HTML, SVG, MD)    │   │
│  └─────────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────┘
                          │
              Agent (from pi-agent-core)
```

---

## Part 3: Smithers Framework Context

Smithers is a workflow orchestration framework using JSX to define AI agent workflows.

### Core Concepts

**Workflow Definition (JSX):**
```tsx
import { smithers, Workflow, Task, Sequence, Ralph } from "smithers";

export default smithers(db, (ctx) => (
  <Workflow name="code-review">
    <Sequence>
      <Task id="analyze" output={schema.analyze} agent={codeAgent}>
        {`Analyze: ${ctx.input.description}`}
      </Task>
      <Task id="review" output={schema.output} agent={reviewAgent}>
        {`Review: ${ctx.output(schema.analyze, { nodeId: "analyze" }).summary}`}
      </Task>
    </Sequence>
  </Workflow>
));
```

**Components:**
- `<Workflow>` - Root container
- `<Task>` - Individual agent task with output schema
- `<Sequence>` - Execute children sequentially
- `<Parallel>` - Execute children concurrently (with maxConcurrency)
- `<Branch>` - Conditional execution (if/then/else)
- `<Ralph>` - Iterative loop until condition met

**Node States:**
| State | Description |
|-------|-------------|
| `pending` | Known, not yet started |
| `waiting-approval` | Awaiting human approval |
| `in-progress` | Currently executing |
| `finished` | Completed successfully |
| `failed` | Completed with error |
| `cancelled` | Unmounted or cancelled |
| `skipped` | Skipped by condition |

### Event System

Smithers emits real-time events:

```typescript
type SmithersEvent =
  | { type: "RunStarted"; runId: string; timestampMs: number }
  | { type: "RunFinished"; runId: string; timestampMs: number }
  | { type: "RunFailed"; runId: string; error: unknown; timestampMs: number }
  | { type: "FrameCommitted"; runId: string; frameNo: number; xmlHash: string; timestampMs: number }
  | { type: "NodeStarted"; runId: string; nodeId: string; iteration: number; attempt: number; timestampMs: number }
  | { type: "NodeFinished"; runId: string; nodeId: string; iteration: number; attempt: number; timestampMs: number }
  | { type: "NodeFailed"; runId: string; nodeId: string; iteration: number; attempt: number; error: unknown; timestampMs: number }
  | { type: "NodeSkipped"; runId: string; nodeId: string; iteration: number; timestampMs: number }
  | { type: "NodeRetrying"; runId: string; nodeId: string; iteration: number; attempt: number; timestampMs: number }
  | { type: "NodeWaitingApproval"; runId: string; nodeId: string; iteration: number; timestampMs: number }
  | { type: "ApprovalRequested"; runId: string; nodeId: string; iteration: number; timestampMs: number }
  | { type: "ApprovalGranted"; runId: string; nodeId: string; iteration: number; timestampMs: number }
  | { type: "ApprovalDenied"; runId: string; nodeId: string; iteration: number; timestampMs: number }
  | { type: "ToolCallStarted"; runId: string; nodeId: string; toolName: string; seq: number; timestampMs: number }
  | { type: "ToolCallFinished"; runId: string; nodeId: string; toolName: string; seq: number; status: "success" | "error"; timestampMs: number }
  | { type: "RevertStarted"; runId: string; nodeId: string; jjPointer: string; timestampMs: number }
  | { type: "RevertFinished"; runId: string; nodeId: string; jjPointer: string; success: boolean; timestampMs: number };
```

### HTTP Server API

Smithers includes an HTTP server for remote control:

```typescript
import { startServer } from "smithers/server";
startServer({ port: 7331 });
```

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/runs` | Start a new workflow run |
| GET | `/v1/runs/:runId` | Get run status |
| POST | `/v1/runs/:runId/resume` | Resume a paused run |
| POST | `/v1/runs/:runId/cancel` | Cancel a running workflow |
| GET | `/v1/runs/:runId/events` | SSE stream of events |
| GET | `/v1/runs/:runId/frames` | Get workflow frames |
| POST | `/v1/runs/:runId/nodes/:nodeId/approve` | Approve a waiting node |
| POST | `/v1/runs/:runId/nodes/:nodeId/deny` | Deny a waiting node |
| GET | `/v1/runs` | List all runs |

### Pi Plugin (for integration)

Smithers provides a pi-plugin client for integration:

```typescript
import * as smithers from "smithers/pi-plugin";

// Start a workflow
const { runId } = await smithers.runWorkflow({
  workflowPath: "./workflow.tsx",
  input: { description: "Fix auth bugs" },
});

// Stream events
for await (const event of smithers.streamEvents({ runId })) {
  console.log(event.type, event);
}

// Approve/deny nodes
await smithers.approve({ runId, nodeId: "review", iteration: 0 });
await smithers.deny({ runId, nodeId: "review", iteration: 0, note: "Needs more work" });

// Get status
const status = await smithers.getStatus({ runId });

// Cancel
await smithers.cancel({ runId });
```

---

## Part 4: Example Smithers Workflow

Here's a real workflow that demonstrates the system:

```tsx
// code-review-loop.tsx
import { smithers, Workflow, Task, Sequence, Ralph } from "smithers";
import { Experimental_Agent as Agent, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { read, edit, bash, grep } from "smithers/tools";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { z } from "zod";

// Database schema
const inputTable = sqliteTable("input", {
  runId: text("run_id").primaryKey(),
  directory: text("directory").notNull(),
  focus: text("focus").notNull(),
});

const reviewTable = sqliteTable("review", {
  runId: text("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  iteration: integer("iteration").notNull().default(0),
  approved: integer("approved", { mode: "boolean" }).notNull(),
  feedback: text("feedback").notNull(),
  issues: text("issues", { mode: "json" }).$type<string[]>(),
}, (t) => ({
  pk: primaryKey({ columns: [t.runId, t.nodeId, t.iteration] }),
}));

export const schema = { input: inputTable, output: reviewTable, review: reviewTable };
export const db = drizzle("./code-review.db", { schema });

// Agents
const reviewAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, grep, bash },
  output: Output.object({ schema: z.object({
    approved: z.boolean(),
    feedback: z.string(),
    issues: z.array(z.string()).optional(),
  })}),
  instructions: "You are a code reviewer...",
});

const fixAgent = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: { read, edit },
  instructions: "You are a senior engineer...",
});

// Workflow
export default smithers(db, (ctx) => {
  const latestReview = ctx.outputs.review?.[ctx.outputs.review.length - 1];
  const isApproved = latestReview?.approved ?? false;

  return (
    <Workflow name="code-review-loop">
      <Ralph until={isApproved} maxIterations={3} onMaxReached="return-last">
        <Sequence>
          <Task id="review" output={schema.review} agent={reviewAgent}>
            {`Review the codebase in: ${ctx.input.directory}`}
          </Task>
          <Task id="fix" output={schema.fix} agent={fixAgent} skipIf={isApproved}>
            {`Fix issues: ${ctx.output(schema.review, { nodeId: "review" }).issues?.join("\n")}`}
          </Task>
        </Sequence>
      </Ralph>
    </Workflow>
  );
});
```

---

## Part 5: Design Requirements

### User Personas

1. **Developer** - Wants to chat with an AI to get coding help, and occasionally trigger complex workflows
2. **Workflow Author** - Creates Smithers workflow scripts, wants to test and debug them
3. **Operator** - Runs workflows, monitors progress, approves/denies gates

### Core User Flows

1. **Normal Chat Mode**
   - User opens app, sees chat interface
   - Types messages to AI agent
   - Agent responds, can use tools (read, write, edit, bash)
   - Agent has access to Smithers plugin to run workflows

2. **Trigger Workflow from Chat**
   - User asks agent: "Run the code review workflow on ./src"
   - Agent calls smithers.runWorkflow() via extension
   - UI shows workflow execution panel
   - User can monitor progress, approve gates

3. **Direct Workflow Management**
   - User opens workflow panel
   - Sees list of workflow scripts (.tsx files)
   - Clicks to run a workflow with input
   - Monitors execution in real-time

4. **Human-in-the-loop Approvals**
   - Workflow reaches a needsApproval gate
   - UI highlights the pending approval
   - User can approve, deny, or ask the agent for advice
   - Workflow continues or fails based on decision

### UI Requirements

#### Main Window Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Menu Bar]  File | Workflow | Settings | Help                   │
├─────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────┬───────────────────────────┤
│ │                                   │                           │
│ │                                   │   Workflow Panel          │
│ │                                   │   (collapsible sidebar)   │
│ │        Chat Interface             │                           │
│ │     (pi-web-ui ChatPanel)         │   - Active runs           │
│ │                                   │   - Node status           │
│ │                                   │   - Approval buttons      │
│ │                                   │   - Event log             │
│ │                                   │                           │
│ ├───────────────────────────────────┤                           │
│ │  [Input area with @mentions]      │                           │
│ └───────────────────────────────────┴───────────────────────────┤
└─────────────────────────────────────────────────────────────────┘
```

#### Workflow Visualization

When a workflow is running, show:
- **Graph view** of the workflow structure (nodes, edges)
- **Node states** with colors (pending=gray, running=blue, success=green, failed=red, waiting=yellow)
- **Real-time event stream** showing what's happening
- **Approval cards** for nodes requiring human input

#### Chat + Workflow Integration

The agent should be able to:
- List available workflows: "What workflows can I run?"
- Start workflows: "Run workflow X with input Y"
- Check status: "How is the code review workflow doing?"
- Handle approvals: "Approve the review node" or "Why does node X need approval?"

This requires a **Smithers pi-extension** that adds:
- Tools for workflow management (runWorkflow, getStatus, approve, deny, etc.)
- Custom message types for workflow events (displayed in chat)
- Possibly custom UI in the artifacts panel for workflow visualization

---

## Part 6: Technical Integration Questions

### Question 1: Pi-mono Integration Strategy

Options:
a) **Embed pi-agent-core + pi-web-ui in Electrobun webview**
   - Run Agent entirely in browser context
   - Use Electrobun RPC for file I/O, process spawning
   - Simplest for UI, but tools need proxying

b) **Run pi-coding-agent in Bun process (RPC mode)**
   - Full pi CLI features available
   - Communicate via stdin/stdout JSON
   - UI just renders events from Bun process

c) **Hybrid: Agent in Bun, UI in webview**
   - Agent logic and tool execution in Bun
   - Stream events to webview for rendering
   - Most flexible, matches Electrobun architecture

### Question 2: Smithers Extension Design

Should the Smithers integration be:
a) **A pi-extension** that registers tools with the agent
b) **A separate panel** in the UI with its own controls
c) **Both** - extension for agent access + dedicated UI for monitoring

### Question 3: Workflow Visualization

How should we visualize workflow execution:
a) **Simple list** of nodes with status badges
b) **DAG graph** rendered with a library (d3, dagre, etc.)
c) **Timeline view** showing execution order
d) **All of the above** with tabs to switch

### Question 4: Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electrobun App                                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Bun Process                              │ │
│  │  ┌─────────────────────┐  ┌─────────────────────────────┐  │ │
│  │  │   Pi Agent (SDK)    │  │   Smithers Server/Engine    │  │ │
│  │  │   - Tools           │  │   - HTTP API                │  │ │
│  │  │   - Extensions      │  │   - Event stream            │  │ │
│  │  │   - Sessions        │  │   - DB (SQLite)             │  │ │
│  │  └──────────┬──────────┘  └──────────┬──────────────────┘  │ │
│  │             │ Smithers Extension     │                      │ │
│  │             └────────────────────────┘                      │ │
│  └──────────────────────────┬─────────────────────────────────┘ │
│                             │ RPC / Events                       │
│  ┌──────────────────────────┴─────────────────────────────────┐ │
│  │                    Webview Process                          │ │
│  │  ┌─────────────────────┐  ┌─────────────────────────────┐  │ │
│  │  │   Chat UI           │  │   Workflow Monitor UI       │  │ │
│  │  │   (pi-web-ui)       │  │   - Run list                │  │ │
│  │  │   - Messages        │  │   - Node graph              │  │ │
│  │  │   - Artifacts       │  │   - Approval controls       │  │ │
│  │  │   - Model selector  │  │   - Event stream            │  │ │
│  │  └─────────────────────┘  └─────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 7: Deliverables Requested

Please provide a detailed specification covering:

### 1. Architecture Specification
- Process model (what runs in Bun vs Webview)
- Communication patterns (RPC types, event streams)
- Data persistence (where sessions/workflows are stored)
- Extension integration points

### 2. UI/UX Specification
- Wireframes or detailed descriptions of each view
- Component hierarchy
- Navigation and user flows
- Responsive behavior

### 3. Smithers Pi-Extension Specification
- Tool definitions for workflow management
- Custom message types for workflow events
- How approvals are surfaced in chat
- How workflow state is synchronized

### 4. Data Models
- Session storage schema
- Workflow run tracking
- Event log structure
- Settings and preferences

### 5. Implementation Phases
- Phase 1: Basic chat with pi-agent
- Phase 2: Smithers integration (run, monitor)
- Phase 3: Approval workflows
- Phase 4: Advanced visualization

### 6. Technical Decisions
- Which pi-mono packages to use where
- How to handle tool execution (browser vs Bun)
- Workflow visualization approach
- Testing strategy

---

## Part 8: Constraints and Preferences

1. **Prefer pi-web-ui components** over building chat UI from scratch
2. **Use Electrobun's RPC** for type-safe communication
3. **Keep the Bun process as the source of truth** for agent state and workflow execution
4. **Make the workflow panel optional/collapsible** - chat should be usable standalone
5. **Design for extensibility** - users may want to add their own tools/panels
6. **Follow pi-mono's philosophy** - minimal core, extend via extensions

---

## Summary

Create a specification for a desktop application that:
- Uses **Electrobun** for the desktop shell
- Embeds a **pi-mono** agent for conversational AI
- Integrates **Smithers** for workflow orchestration via a pi-extension
- Provides a unified UI for chat + workflow monitoring
- Enables human-in-the-loop approvals with visual feedback

The design should be practical, implementation-focused, and leverage the existing APIs of all three frameworks as documented above.

---

## Addendum to Design Prompt: Fork Code State + Context Together

### Feature Area 8: Coupled Context + Code Forking ("Workspace Forks")

You are designing an advanced "fork" system in Smithers chat. Today, forking is effectively a conversation/thread fork (Codex thread fork + rollback to a turn), and it does not fork the workspace code state by default. We want an optional "fork code state too" mode so that a user can branch both:

1. Chat context (Codex thread history up to a turn/message), and
2. Code state (the workspace file tree state at that same point in time),

... into a new chat session.

#### Core requirements

1. Default behavior remains context-only fork
   - "Fork" should keep doing what it does today unless the user explicitly opts into code forking.
   - Add a user preference: "Default fork includes code state" (off by default).

2. Fork-with-code must be point-in-time accurate
   - If a user forks "from message X / turn T", the forked session's code state must correspond to that point (or a clearly defined variant, e.g. before vs after the turn's file changes).
   - Smithers already has JJ revert tied to some messages. Use that existing snapshot concept as the conceptual anchor for "what is the code state at this turn?"

3. Fork-with-code must be safe and non-destructive
   - No silent discarding of uncommitted/unapplied changes.
   - If the current workspace has unsaved edits or dirty state, the UX must explicitly handle it (capture snapshot, prompt, or create a safe temporary commit/change).

4. Fork-with-code must integrate with multi-fork / fan-out
   - If the user "fans out" into N chats, they must be able to choose whether:
     - All forks share the same code state (one code fork), or
     - Each fork gets its own independent code sandbox (N code forks).

5. Fork-with-code must support a "merge back" story
   - Users need a path to bring changes back to main (or between forks) with minimal friction.
   - The merge-back UX can be v1 "diff/apply" and v2 "VCS merge/rebase," but you must design at least one workable v1.

---

### Design problem: define "Code Fork" semantics

You must pick (or propose) a concrete model for how Smithers represents forked code state. Provide at least two viable options and recommend one for v1.

#### Option A (recommended for v1): "Single working directory, multiple code states; switch on tab activation"

- Each chat session is associated with a code state reference (e.g., a JJ change/commit/bookmark).
- Only one code state is checked out in the on-disk working copy at a time.
- When the user selects a chat tab, Smithers can offer to activate that chat's code state (checkout/switch), making the workspace match that chat.

Pros: minimal filesystem complexity; fits "WorkspaceState is per-root-directory."
Cons: cannot safely run concurrent "agent modifies files" turns across multiple chats without collisions; requires guardrails.

Guardrails you must design:
- Prevent running background turns in non-active code forks, or
- Allow it but require isolated sandboxes (Option B) for concurrency.

#### Option B: "Isolated sandboxes per code fork" (JJ workspace add / git worktree / filesystem clone)

- Fork-with-code creates a separate working copy directory for the fork.
- Each forked chat session is tied to a distinct `rootDirectory` / `cwd`.
- The IDE either:
  - Opens each sandbox in a new window (new WorkspaceState), or
  - Supports multi-root workspaces (harder; design but may be v2).

Pros: true parallelism; safe concurrent agent file changes.
Cons: heavier UX + lifecycle (cleanup, indexing, watch services); more storage.

For JJ-first workflows, explicitly explore using JJ multi-workspace / working copy features conceptually (e.g., "workspace add"), but keep the design tool-agnostic enough to work with git worktrees or fallback snapshotting.

#### Option C (fallback): "Filesystem snapshot fork"

- For non-VCS repos, create an APFS clone/copy-on-write snapshot or a tarball snapshot.
- Merge-back is "diff/apply".

---

### UX: how users invoke fork-with-code

Design these entry points:

1. Message hover action bar
   - Replace/extend "Fork" with a split-button or menu:
     - "Fork chat"
     - "Fork chat + code state..."
   - Or keep "Fork" but open a sheet with a checkbox: [ ] Include code state.

2. Multi-fork / Fan-out sheet
   - Add a section:
     - Code state for forks
       - ( ) Context only (default)
       - ( ) Include code state (shared across forks)
       - ( ) Include code state (separate sandbox per fork)
   - Include an estimate indicator: "This will create 4 sandboxes" (no time estimates; just count + storage caution).

3. Keyboard / Command Palette
   - Commands:
     - `Fork Chat From Here...`
     - `Fork Chat + Code From Here...`
     - `Fan-out...`

---

### Define the fork point precisely

When forking "from a message", the system must define what "the code at that message" means.

Design a "Fork Point" model that supports:
- Turn-based selection (preferred): fork from a `turnId` boundary.
- Before vs after semantics:
  - Before the turn's file changes
  - After the turn's file changes
- If the user selects a message that lacks a snapshot, define fallback behavior:
  - Use nearest prior snapshot
  - Or create a new snapshot now (explicitly indicated)

Provide UX language that makes this unambiguous.

---

### Visual design: show which code state a chat is bound to

Each chat tab should indicate whether it is:
- Context-only (no code binding)
- Bound to code fork (and which one)

Design:
- A small badge in the tab (e.g., `C+` or a branch icon)
- A tooltip / inspector panel that shows:
  - Chat short ID (gist ID)
  - Code fork ID (if any)
  - Base revision / snapshot reference
  - "Activate code state" / "Diff vs main" / "Merge back"

Also design a Code Fork Manager surface:
- List code forks across chats
- Which is active
- Cleanup / delete fork
- Rename fork (e.g., "Experiment A")

---

### Data model changes (must specify fields/types)

You must propose concrete additions to the Swift data model, at minimum:

1. ChatSessionState
   - Add `codeBinding` metadata:
     - `codeForkId` (short ID)
     - `codeForkMode` enum: `.none`, `.switchable`, `.sandbox`
     - `codeBaseRef` (opaque reference to snapshot/commit/op)
     - `codeRootOverrideURL` (only for sandbox mode)
     - `createdFromTurnId` / `createdFromMessageId`

2. Turn / snapshot mapping
   - If code snapshots are per-turn, define a `TurnCodeSnapshot` mapping:
     - `turnId -> snapshotRef`
   - If the snapshot is stored on `ChatMessage`, explain how that scales when multiple messages share a turn.

3. Persistence
   - Extend ChatHistoryStore payload (or create a new store) so that:
     - Code bindings are persisted per session
     - Fork relationships are persisted (parent session id, fork point)
   - Ensure backward compatibility.

---

### Merge-back flows (v1 must be viable)

Design at least one v1 merge-back workflow that does not depend on a full VCS UI:

- "Diff & Apply Back to Main"
  - From a forked session: generate diff vs base (or vs main)
  - Show in existing diff UI
  - Allow apply, with conflict handling UX (even if basic)

Optionally design v2:
- JJ/Git native merge/rebase UI affordances

---

### Edge cases and constraints (explicitly cover)

You must design behavior for:
- Unsaved editor buffers when forking-with-code
- Dirty working copy when activating a different chat's code state
- Streaming turns: fork action disabled or queue semantics
- Concurrent turns across sessions:
  - If code is shared: enforce "one turn that can mutate code at a time" or require sandbox mode
- Non-VCS workspaces
- Large repos: sandbox creation cost; cleanup policy
- Cross-chat message routing when source/target have different code forks:
  - How to represent referenced context (and diffs) safely
  - How to prevent "apply this diff" accidents when bases differ

---

### CLI surface (smithersctl) additions

Design CLI parity for fork-with-code:

- `smithersctl chat fork <chat-id> --at <turn-or-message> [--with-code] [--code-mode switch|sandbox]`
- `smithersctl chat list` (must show chat short IDs and code binding)
- `smithersctl codefork list`
- `smithersctl codefork activate <codefork-id>`
- `smithersctl codefork diff <codefork-id> [--against main|<codefork-id>]`
- `smithersctl codefork merge <codefork-id> --into <codefork-id|main>` (can be v2)

Define output formats suitable for scripting.

---

### Prioritization guidance

You must propose a v1 that is shippable with minimal architectural disruption:

- Must-have v1
  - Fork chat + (optional) attach code snapshot reference
  - Clear UI indication of code binding
  - A safe "activate this code state" flow (if using switchable mode)
  - Diff/apply merge-back to main

- Nice-to-have / v2
  - True sandbox per fork (worktrees / JJ workspace add) with multi-window or multi-root
  - Concurrent agent execution across code forks
  - Rich merge UI, rebase UI, conflict resolution workflows

---

### Deliverables for this feature area

For "Coupled Context + Code Forking", produce:

1. User stories
2. End-to-end interaction flows (GUI + CLI)
3. Visual design recommendations (macOS-native)
4. Data model + persistence changes
5. Edge cases + safety constraints
6. v1 vs v2 scope recommendation
