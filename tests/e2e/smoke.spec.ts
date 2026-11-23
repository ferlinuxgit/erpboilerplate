import { test, expect } from "@playwright/test";

test("home carga", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Factura, contabiliza y presenta impuestos/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pagas por lo que usas. Nada más." })).toBeVisible();
});

test("design system público", async ({ page }) => {
  await page.goto("/design-system");
  await expect(page.getByRole("heading", { level: 1, name: /Retro, claro y hecho para cifras/ })).toBeVisible();
});
