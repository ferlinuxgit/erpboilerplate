import { test, expect } from "@playwright/test";

test("home carga", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Todo el negocio/ })).toBeVisible();
});
