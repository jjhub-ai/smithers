#!/usr/bin/env -S deno run --allow-read --allow-run

/**
 * Copy subsets of Smithers source code to clipboard (~100KB each)
 *
 * Usage: deno run --allow-read --allow-run scripts/copy-source.ts --target <name>
 *    or: ./scripts/copy-source.ts --target <name>
 *
 * Targets:
 *   core       App entry, ContentView, FileItem, FileTree, theme, prefs, EditorPreferences
 *   state1     WorkspaceState.swift lines 1-2300
 *   state2     WorkspaceState.swift lines 2301-4600
 *   state3     WorkspaceState.swift lines 4601-end + WorkspaceState+Preferences
 *   editor     Neovim, MultiCursor, Syntax, EditorCursor, GhostText
 *   terminal   Ghostty terminal, input, frame scheduler, app
 *   chat       ChatView, ChatHistory, ChatSession, CodexService
 *   vcs        JJ service, models, panel, snapshots, commits, agents
 *   skills     All Skill files + CodebaseAnalyzer
 *   ui         CommandPalette, Search, Diff, Scrollbar, Tabs, Overlays
 *   infra      IPC, CLI, RPC, Transport, KeyboardModel, CloseGuard
 *   config     Package.swift, project.yml
 *   all        Print all target names and sizes
 */

import { join } from "https://deno.land/std/path/mod.ts";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const DESKTOP = join(ROOT, "apps", "desktop");
const S = join(DESKTOP, "Smithers");

// ── Target definitions ──────────────────────────────────────────────

const targets: Record<string, () => Promise<string>> = {
  core: () =>
    collectFiles([
      `${S}/SmithersApp.swift`,
      `${S}/ContentView.swift`,
      `${S}/FileItem.swift`,
      `${S}/FileTreeSidebar.swift`,
      `${S}/AppTheme.swift`,
      `${S}/EditorPreferences.swift`,
      `${S}/PreferencesView.swift`,
      `${S}/PreferencesModels.swift`,
      `${S}/TabBarItem.swift`,
      `${S}/WorkspaceOverlayView.swift`,
      `${S}/Typography.swift`,
      `${S}/DirectoryWatcher.swift`,
      `${S}/UpdateController.swift`,
      `${S}/PressAndHoldDisabler.swift`,
    ]),

  state1: () => sliceFile(`${S}/WorkspaceState.swift`, 1, 2300),
  state2: () => sliceFile(`${S}/WorkspaceState.swift`, 2301, 4600),
  state3: async () => {
    const slice = await sliceFile(`${S}/WorkspaceState.swift`, 4601);
    const ext = await collectFiles([`${S}/WorkspaceState+Preferences.swift`]);
    return slice + ext;
  },

  editor: () =>
    collectFiles([
      `${S}/NvimController.swift`,
      `${S}/NvimRPC.swift`,
      `${S}/NvimUIState.swift`,
      `${S}/NvimViewport.swift`,
      `${S}/NvimExtUIOverlay.swift`,
      `${S}/NvimFloatingWindowEffects.swift`,
      `${S}/MultiCursorTextView.swift`,
      `${S}/SyntaxHighlighting.swift`,
      `${S}/EditorCompletion.swift`,
      `${S}/EditorCursorView.swift`,
      `${S}/EditorCursorGroupView.swift`,
      `${S}/GhostTextOverlayView.swift`,
    ]),

  terminal: () =>
    collectFiles([
      `${S}/GhosttyTerminalView.swift`,
      `${S}/GhosttyApp.swift`,
      `${S}/GhosttyInput.swift`,
      `${S}/GhosttyFrameScheduler.swift`,
      `${S}/TerminalTabView.swift`,
      `${S}/TmuxKeyHandler.swift`,
      `${S}/InputMethodSwitcher.swift`,
    ]),

  chat: () =>
    collectFiles([
      `${S}/ChatView.swift`,
      `${S}/ChatSessionState.swift`,
      `${S}/ChatHistoryStore.swift`,
      `${S}/CodexService.swift`,
      `${S}/CodexCompletionService.swift`,
      `${S}/LinkifiedText.swift`,
      `${S}/MarkdownView.swift`,
    ]),

  vcs: () =>
    collectFiles([
      `${S}/JJService.swift`,
      `${S}/JJModels.swift`,
      `${S}/JJPanelView.swift`,
      `${S}/JJSnapshotStore.swift`,
      `${S}/CommitStyleDetector.swift`,
      `${S}/AgentOrchestrator.swift`,
      `${S}/AgentDashboardView.swift`,
    ]),

  skills: () =>
    collectFiles([
      `${S}/SkillModels.swift`,
      `${S}/SkillListView.swift`,
      `${S}/SkillBrowserView.swift`,
      `${S}/SkillDetailView.swift`,
      `${S}/SkillUseView.swift`,
      `${S}/SkillModal.swift`,
      `${S}/SkillCreationModels.swift`,
      `${S}/CreateSkillWizardView.swift`,
      `${S}/SkillTemplateBuilder.swift`,
      `${S}/SkillScanner.swift`,
      `${S}/SkillFrontmatterParser.swift`,
      `${S}/SkillInstaller.swift`,
      `${S}/SkillInstallStore.swift`,
      `${S}/SkillRegistryClient.swift`,
      `${S}/SkillRegistryDetailView.swift`,
      `${S}/CodebaseAnalyzer.swift`,
    ]),

  ui: () =>
    collectFiles([
      `${S}/CommandPaletteView.swift`,
      `${S}/SearchPanelView.swift`,
      `${S}/DiffViewer.swift`,
      `${S}/ScrollbarOverlayView.swift`,
      `${S}/ScrollbarHostingView.swift`,
      `${S}/SmoothScrollController.swift`,
      `${S}/PerformanceMonitor.swift`,
      `${S}/PerformanceOverlayView.swift`,
      `${S}/WebviewTabView.swift`,
    ]),

  infra: () =>
    collectFiles([
      `${S}/SmithersIPCServer.swift`,
      `${S}/SmithersCtlInterpreter.swift`,
      `${S}/JSONRPCTransport.swift`,
      `${S}/KeyboardShortcutsModel.swift`,
      `${S}/KeyboardShortcutsPanel.swift`,
      `${S}/CloseGuard.swift`,
      `${S}/WindowFrameStore.swift`,
      `${S}/ThreadHistoryStore.swift`,
      `${DESKTOP}/SmithersCLI/main.swift`,
      `${DESKTOP}/SmithersShared/SmithersIPC.swift`,
    ]),

  config: () =>
    collectFiles([`${DESKTOP}/Package.swift`, `${DESKTOP}/project.yml`]),
};

// ── Helpers ─────────────────────────────────────────────────────────

function fileHeader(path: string, suffix = ""): string {
  const rel = path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
  const label = suffix ? `${rel} ${suffix}` : rel;
  return [
    "// ============================================",
    `// FILE: ${label}`,
    "// ============================================",
    "",
  ].join("\n");
}

async function collectFiles(paths: string[]): Promise<string> {
  const parts: string[] = [];
  for (const p of paths) {
    try {
      const content = await Deno.readTextFile(p);
      parts.push(fileHeader(p) + content + "\n\n");
    } catch {
      console.error(`WARNING: ${p} not found`);
    }
  }
  return parts.join("");
}

async function sliceFile(
  path: string,
  startLine: number,
  endLine?: number
): Promise<string> {
  const content = await Deno.readTextFile(path);
  const lines = content.split("\n");
  const sliced = endLine
    ? lines.slice(startLine - 1, endLine)
    : lines.slice(startLine - 1);
  const suffix = endLine
    ? `(lines ${startLine}-${endLine})`
    : `(lines ${startLine}-${lines.length})`;
  return fileHeader(path, suffix) + sliced.join("\n") + "\n";
}

async function pbcopy(text: string): Promise<void> {
  const cmd = new Deno.Command("pbcopy", {
    stdin: "piped",
  });
  const proc = cmd.spawn();
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  await proc.status;
}

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`;
}

async function showSizes(): Promise<void> {
  console.log("Smithers source code targets:\n");
  let total = 0;
  for (const name of Object.keys(targets)) {
    const content = await targets[name]();
    const size = new TextEncoder().encode(content).length;
    total += size;
    console.log(`  --target ${name.padEnd(10)} ${formatKB(size)}`);
  }
  console.log(`\n  Total: ${formatKB(total)} across ${Object.keys(targets).length} targets`);
}

// ── Main ────────────────────────────────────────────────────────────

const args = [...Deno.args];
let target: string | null = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--target" || args[i] === "-t") && args[i + 1]) {
    target = args[i + 1];
    break;
  }
}

if (!target) {
  console.log(
    "Usage: ./scripts/copy-source.ts --target <name>\n"
  );
  await showSizes();
  Deno.exit(0);
}

if (target === "all" || target === "list") {
  await showSizes();
  Deno.exit(0);
}

if (!(target in targets)) {
  console.error(`Unknown target: ${target}\n`);
  await showSizes();
  Deno.exit(1);
}

const content = await targets[target]();
await pbcopy(content);
const size = new TextEncoder().encode(content).length;
console.log(`Copied --target ${target} to clipboard (${formatKB(size)})`);
