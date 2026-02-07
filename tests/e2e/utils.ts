import { expect, type Page } from "@playwright/test";

export const workspaceRoot = process.env.SMITHERS_WORKSPACE ?? process.cwd();
export const helloWorkflowPath = "workflows/hello.tsx";
export const approvalWorkflowPath = "workflows/approval.tsx";

export async function waitForAppReady(page: Page) {
  await page.goto("/");
  await page.waitForSelector(".app");
  await page.waitForFunction(() => {
    const select = document.querySelector("#session-select") as HTMLSelectElement | null;
    return Boolean(select && select.options.length > 0);
  });
  await page.waitForSelector(".chat-panel");
}

export async function openMenu(page: Page, menuKey: string) {
  await page.locator(`.menu-item[data-menu='${menuKey}']`).click();
  await page.waitForSelector(".menu-dropdown:not(.hidden)");
}

export async function openWorkspaceDialog(page: Page) {
  await openMenu(page, "file");
  await page.locator(".menu-row", { hasText: "Open Workspace" }).click();
  await page.waitForSelector("#workspace-path");
}

export async function openSettingsDialog(page: Page) {
  await openMenu(page, "settings");
  await page.locator(".menu-row", { hasText: "Preferences" }).click();
  await page.waitForSelector("#settings-panel-open");
}

export async function ensureWorkspace(page: Page) {
  const select = page.locator("#workspace-select");
  const current = await select.inputValue();
  if (current === workspaceRoot) return;

  await openWorkspaceDialog(page);
  await page.fill("#workspace-path", workspaceRoot);
  await page.click("#workspace-open");
  await page.waitForSelector("#workspace-path", { state: "detached" });
  await expect(select).toHaveValue(workspaceRoot);
}

export async function startFreshSession(page: Page) {
  const select = page.locator("#session-select");
  const previous = await select.inputValue();
  await page.click("#new-session");
  await page.waitForFunction(
    (prev) => {
      const select = document.querySelector("#session-select") as HTMLSelectElement | null;
      return Boolean(select && select.value && select.value !== prev);
    },
    previous,
  );
  await page.waitForFunction(() => {
    const textarea = document.querySelector(".chat-panel textarea") as HTMLTextAreaElement | null;
    return Boolean(textarea && !textarea.disabled);
  });
}

export async function waitForWorkflowsLoaded(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll(".workflow-row").length > 0);
}

export async function runWorkflowViaDialog(
  page: Page,
  workflowPath: string,
  input: Record<string, unknown>,
) {
  await page.click("#run-workflow");
  await page.waitForSelector("#workflow-select");
  await page.selectOption("#workflow-select", { value: workflowPath });
  await page.fill("#workflow-input", JSON.stringify(input));

  const [response] = await Promise.all([
    page.waitForResponse((res) => {
      if (!res.url().includes("/rpc")) return false;
      if (res.request().method() !== "POST") return false;
      const body = res.request().postData() ?? "";
      return body.includes("\"method\":\"runWorkflow\"");
    }),
    page.click("#modal-run"),
  ]);

  const payload = await response.json();
  const runId = payload?.result?.runId as string;
  if (!runId) {
    throw new Error(`runWorkflow did not return runId: ${JSON.stringify(payload)}`);
  }
  const prefix = runId.slice(0, 6);

  await page.waitForSelector("#workflow-select", { state: "detached" });
  return { runId, prefix };
}

export async function waitForRunStatus(page: Page, prefix: string, status: string, timeout = 30_000) {
  await page.click("#tab-runs");
  await expect(page.locator(`.run-row.status-${status}`, { hasText: prefix })).toBeVisible({ timeout });
}
