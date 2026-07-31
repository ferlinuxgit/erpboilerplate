import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("la configuración PDF permite ocultar email y teléfono", async ({ page }) => {
  await registerAndSignIn(page, "PDF Settings E2E");
  await completeOnboarding(page, "Empresa PDF Settings E2E S.L.");

  await page.goto("/settings/company");
  await expect(page.getByRole("heading", { name: "Diseño y contenido de PDFs" })).toBeVisible();
  await page.getByLabel("Mostrar email").uncheck();
  await page.getByLabel("Mostrar teléfono").uncheck();

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/company/pdf-settings") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Guardar configuración PDF" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();

  const settingsResponse = await page.request.get("/api/company/pdf-settings");
  expect(settingsResponse.ok()).toBeTruthy();
  expect(await settingsResponse.json()).toMatchObject({
    showEmail: false,
    showPhone: false,
    showWebsite: true,
    showPaymentMethod: true,
    showTaxBreakdown: true,
  });
});
