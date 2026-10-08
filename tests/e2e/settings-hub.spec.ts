import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("Configuración: un solo punto de entrada, buscador de ajustes y enlaces antiguos redirigidos", async ({ page }, testInfo) => {
  await registerAndSignIn(page, "Settings hub E2E");
  await completeOnboarding(page, "Empresa configuración E2E S.L.");

  await page.goto("/dashboard");
  await page.getByTestId("desktop-sidebar").getByRole("link", { name: "Configuración" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Configuración" })).toBeVisible();
  for (const section of ["Empresa", "Documentos", "Fiscalidad", "Cobros y pagos", "Contabilidad", "Bancos", "Equipo", "Suscripción"]) {
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  }
  await testInfo.attach("settings-hub", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.getByLabel("Buscar un ajuste").fill("iban");
  const results = page.locator("#settings-results");
  await expect(results.getByRole("link", { name: /Formas de pago/ })).toBeVisible();
  await testInfo.attach("settings-search", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await results.getByRole("link", { name: /Formas de pago/ }).click();
  await expect(page).toHaveURL(/\/settings\/payments#formas-de-pago$/);
  await expect(page.getByRole("heading", { level: 2, name: "Formas de pago" })).toBeVisible();
  await expect(page.getByTestId("context-navigation").getByRole("link", { name: "Cobros y pagos" })).toHaveAttribute("aria-current", "page");
  await testInfo.attach("settings-payments", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.goto("/fiscal/settings");
  await expect(page).toHaveURL(/\/settings\/fiscal$/);
  await expect(page.getByRole("heading", { level: 2, name: "Perfil fiscal" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Impuestos y retenciones" })).toBeVisible();

  const profileSaved = page.waitForResponse((response) => response.url().endsWith("/api/fiscal-profile") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  expect((await profileSaved).ok()).toBeTruthy();

  await page.goto("/invoices/collections/settings");
  await expect(page).toHaveURL(/\/settings\/payments#emails$/);
  await page.goto("/settings/masters");
  await expect(page).toHaveURL(/\/settings$/);

  await page.goto("/settings/documents");
  await expect(page.getByRole("heading", { level: 2, name: "Logo y pie de factura" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Series de numeración" })).toBeVisible();
  await testInfo.attach("settings-documents", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
