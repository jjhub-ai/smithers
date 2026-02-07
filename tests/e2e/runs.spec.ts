import { test, expect } from "@playwright/test";
import {
  waitForAppReady,
  ensureWorkspace,
  helloWorkflowPath,
  runWorkflowViaDialog,
  waitForRunStatus,
} from "./utils";

test.describe("Run Inspector", () => {
  test("graph, node drawer, logs, attempts, and exports", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);

    const name = `Graph-${Date.now()}`;
    const { runId, prefix } = await runWorkflowViaDialog(page, helloWorkflowPath, { name });
    await waitForRunStatus(page, prefix, "finished");

    await page.locator(".run-row.status-finished", { hasText: prefix }).first().click();
    await expect(page.locator(".run-header__meta .mono", { hasText: runId })).toBeVisible();

    // Graph tab
    await page.locator(".run-tab[data-tab='graph']").click();
    await expect(page.locator(".graph-canvas svg")).toBeVisible();

    const transformBaseline = await page.locator(".graph-canvas").evaluate((el) => el.style.transform);
    await page.locator("[data-graph-action='zoom-in']").click();
    const transformZoomedIn = await page.locator(".graph-canvas").evaluate((el) => el.style.transform);
    expect(transformZoomedIn).not.toEqual(transformBaseline);

    await page.locator("[data-graph-action='zoom-out']").click();
    const transformZoomedOut = await page.locator(".graph-canvas").evaluate((el) => el.style.transform);
    expect(transformZoomedOut).not.toEqual(transformZoomedIn);

    await page.locator("[data-graph-action='fit']").click();
    const transformReset = await page.locator(".graph-canvas").evaluate((el) => el.style.transform);
    expect(transformReset).toEqual(transformBaseline);

    // Open node drawer
    await page.locator("[data-node-id='hello']").first().click();
    await expect(page.locator(".node-drawer__title")).toHaveText("hello");
    const outputSection = page.locator(
      ".node-drawer__section:has(.node-drawer__label:has-text('Output'))",
    );
    await expect(outputSection.locator("pre")).toContainText(`Hello, ${name}`);

    await page.locator(".node-drawer__actions [data-copy='output']").click();
    await expect(page.locator(".toast.toast-info")).toContainText("Output copied");

    // Timeline tab
    await page.locator(".run-tab[data-tab='timeline']").click();
    const timelineCount = await page.locator(".timeline-row").count();
    expect(timelineCount).toBeGreaterThan(0);

    // Logs tab
    await page.locator(".run-tab[data-tab='logs']").click();
    await expect(page.locator(".logs")).toContainText("RunStarted");
    await page.fill("#logs-search", "RunStarted");
    await expect(page.locator(".logs")).toContainText("RunStarted");

    await page.locator(".logs-filter", { hasText: "Run" }).click();
    const logsText = await page.locator(".logs").textContent();
    expect((logsText ?? "").includes("RunStarted")).toBe(false);

    const downloadPromise = page.waitForEvent("download");
    await page.click("#logs-export");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("logs.jsonl");

    // Re-enable run filter before copy so logs have content
    await page.locator(".logs-filter", { hasText: "Run" }).click();
    await expect(page.locator(".logs")).toContainText("RunStarted");

    // Copy logs
    await page.evaluate(() => {
      (window as any).__copiedLogs = "";
      (navigator as any).clipboard = {
        writeText: (t: string) => { (window as any).__copiedLogs = t; return Promise.resolve(); },
      };
    });
    await page.click("#logs-copy");
    await expect(page.locator(".toast.toast-info")).toContainText("Logs copied");
    const copiedLogs = await page.evaluate(() => (window as any).__copiedLogs as string);
    expect(copiedLogs).toContain("RunStarted");

    // Attempts tab
    await page.locator(".run-tab[data-tab='attempts']").click();
    const attemptsCount = await page.locator(".attempt-row").count();
    expect(attemptsCount).toBeGreaterThan(0);
  });
});
