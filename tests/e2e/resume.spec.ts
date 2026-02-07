import { test, expect } from "@playwright/test";
import {
  waitForAppReady,
  ensureWorkspace,
  approvalWorkflowPath,
  runWorkflowViaDialog,
  waitForRunStatus,
  startFreshSession,
} from "./utils";

test.describe("Resume Run", () => {
  test("resume a denied (failed) run from inspector and complete it", async ({ page }) => {
    await waitForAppReady(page);
    await ensureWorkspace(page);
    await startFreshSession(page);

    const name = `Resume-${Date.now()}`;
    const { runId, prefix } = await runWorkflowViaDialog(page, approvalWorkflowPath, { name });
    await waitForRunStatus(page, prefix, "waiting-approval");

    await page.locator(".run-row.status-waiting-approval", { hasText: prefix }).first().click();
    await expect(page.locator(".run-header__meta .mono", { hasText: runId })).toBeVisible();

    await page.locator(".approval-card .btn.btn-danger", { hasText: "Deny" }).click();
    await waitForRunStatus(page, prefix, "failed");

    await page.locator(".run-row.status-failed", { hasText: prefix }).first().click();
    await expect(page.locator(".run-header__meta")).toContainText("failed");

    const resumeBtn = page.locator("#sidebar button", { hasText: "Resume" });
    await expect(resumeBtn).toBeVisible();

    await Promise.all([
      page.waitForResponse((res) => {
        if (!res.url().includes("/rpc")) return false;
        if (res.request().method() !== "POST") return false;
        const body = res.request().postData() ?? "";
        return body.includes('"method":"resumeRun"');
      }),
      resumeBtn.click(),
    ]);

    await expect(page.locator(".toast.toast-info")).toContainText("Run resumed");
    await waitForRunStatus(page, prefix, "waiting-approval", 60_000);

    await page.locator(".run-row.status-waiting-approval", { hasText: prefix }).first().click();
    await expect(page.locator(".approval-card__title")).toContainText("Approval Required");

    await page.locator(".approval-card .btn.btn-primary", { hasText: "Approve" }).click();
    await waitForRunStatus(page, prefix, "finished");

    await page.locator(".run-row.status-finished", { hasText: prefix }).first().click();
    await page.locator(".run-tab[data-tab='outputs']").click();
    await expect(page.locator(".output-table pre")).toContainText(`Approved: ${name}`);
    await expect(page.locator(".output-table pre")).toContainText(`Done: ${name}`);
  });
});
