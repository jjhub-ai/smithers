import { test, expect } from "@playwright/test";
import {
  waitForAppReady,
  ensureWorkspace,
  helloWorkflowPath,
  runWorkflowViaDialog,
  waitForRunStatus,
  startFreshSession,
  waitForWorkflowsLoaded,
} from "./utils";

test.describe("Chat Features", () => {
  test("shows warning when no API key configured", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const input = page.locator(".chat-panel textarea");
    await input.fill("Hello from Playwright");
    await page.locator(".chat-panel button", { hasText: "Send" }).click();

    const assistant = page.locator(".chat-panel .message--assistant", {
      hasText: "No API key is configured",
    });
    await expect(assistant.last()).toBeVisible();
  });

  test("runs tool command and shows tool result", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const input = page.locator(".chat-panel textarea");
    await input.fill(`/read ${helloWorkflowPath}`);
    await page.locator(".chat-panel button", { hasText: "Send" }).click();

    const toolResult = page.locator(".chat-panel .message--toolResult").last();
    await expect(toolResult).toContainText("read");
    await expect(toolResult).toContainText("@jsxImportSource");
  });

  test("shows workflow mention suggestions", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);
    await waitForWorkflowsLoaded(page);

    const input = page.locator(".chat-panel textarea");
    await input.fill("@workflow(");
    await expect(page.locator(".mention-box")).toBeVisible();
    await expect(page.locator(".mention-box .mention-item", { hasText: "hello" })).toBeVisible();

    await page.locator(".mention-box .mention-item", { hasText: "hello" }).click();
    await expect(input).toHaveValue(`@workflow(${helloWorkflowPath})`);
  });

  test("shows run mention suggestions", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const { prefix } = await runWorkflowViaDialog(page, helloWorkflowPath, { name: "Mentions" });
    await waitForRunStatus(page, prefix, "finished");

    await page.click("#tab-chat");
    const input = page.locator(".chat-panel textarea");
    await input.fill("#run(");
    await expect(page.locator(".mention-box")).toBeVisible();
    await expect(page.locator(".mention-box .mention-item", { hasText: prefix })).toBeVisible();
  });

  test("creates a workflow via chat and it appears in workflows list", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const name = `e2e-${Date.now()}`;
    const input = page.locator(".chat-panel textarea");
    await input.fill(`create a workflow called ${name}`);
    await page.locator(".chat-panel button", { hasText: "Send" }).click();

    const assistant = page.locator(".chat-panel .message--assistant", {
      hasText: "Created workflow",
    });
    await expect(assistant.last()).toBeVisible({ timeout: 15_000 });
    await expect(assistant.last()).toContainText(name);

    await page.click("#tab-workflows");
    await expect(page.locator(".workflow-row__title", { hasText: name })).toBeVisible({ timeout: 10_000 });
  });

  test("shows workflow card in chat when run is attached", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const { runId, prefix } = await runWorkflowViaDialog(page, helloWorkflowPath, { name: "Card" });
    await waitForRunStatus(page, prefix, "finished");

    await page.click("#tab-chat");
    const shortId = runId.slice(0, 8);
    const card = page.locator(".chat-panel .workflow-card").filter({ hasText: shortId });
    await expect(card).toBeVisible();
    await expect(card.locator(".workflow-card__title")).toHaveText("hello");
  });
});
