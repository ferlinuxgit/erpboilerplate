import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers/authenticated-session";

test.describe("admin security policy", () => {
  test("admin changes a security setting and sees the audit entry", async ({ page }) => {
    await registerAndSignIn(page, "Security Policy Admin E2E");

    await page.goto("/settings/security");
    await expect(page.getByRole("heading", { name: "Tenant security controls" })).toBeVisible();

    const currentTimeout = Number(await page.getByLabel("Session timeout (minutes)").inputValue());
    const timeoutMinutes = `${Number.isFinite(currentTimeout) && currentTimeout >= 5 && currentTimeout < 1440 ? currentTimeout + 1 : 45}`;
    await page.getByLabel("Session timeout (minutes)").fill(timeoutMinutes);
    await page.getByLabel("Enabled").check();
    await page.getByRole("button", { name: "Save security policy" }).click();

    await expect(page.getByText("Security policy updated and audited.")).toBeVisible();
    await expect(page.getByLabel("Current security policy state").getByText(`${timeoutMinutes} minutes`)).toBeVisible();

    await page.goto("/settings/audit");
    await expect(page.getByText(/security_policy\.(created|updated)/).first()).toBeVisible();
  });
});
