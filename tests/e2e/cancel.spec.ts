import { test, expect } from "@playwright/test";
import {
  waitForAppReady,
  ensureWorkspace,
  approvalWorkflowPath,
  runWorkflowViaDialog,
  waitForRunStatus,
  startFreshSession,
} from "./utils";

test.describe("Cancel Run", () => {
  test("cancel from run list while waiting-approval", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const { prefix } = await runWorkflowViaDialog(page, approvalWorkflowPath, {
      name: "CancelList",
    });
    await waitForRunStatus(page, prefix, "waiting-approval");

    const row = page.locator(".run-row.status-waiting-approval", { hasText: prefix }).first();
    await row.locator("[data-action='cancel']").click();

    await expect(page.locator(".toast.toast-info")).toContainText("Run cancelled");
    await waitForRunStatus(page, prefix, "cancelled");
  });

  test("cancel from inspector while waiting-approval", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const { runId, prefix } = await runWorkflowViaDialog(page, approvalWorkflowPath, {
      name: "CancelInsp",
    });
    await waitForRunStatus(page, prefix, "waiting-approval");

    await page.locator(".run-row.status-waiting-approval", { hasText: prefix }).first().click();
    await expect(page.locator(".run-header__meta .mono", { hasText: runId })).toBeVisible();

    const cancelBtn = page.locator("#sidebar button", { hasText: "Cancel" });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(page.locator(".toast.toast-info")).toContainText("Run cancelled");
    await waitForRunStatus(page, prefix, "cancelled");

    await page.locator(".run-row.status-cancelled", { hasText: prefix }).first().click();
    await expect(page.locator(".run-header__meta")).toContainText("cancelled");
  });
});
