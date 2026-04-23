import { test, expect } from "@playwright/test";

test("home carga", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("ERP SaaS Starter")).toBeVisible();
});
