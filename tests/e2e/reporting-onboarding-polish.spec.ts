import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers/authenticated-session";

test("reporting guides users through period, KPI context, export status, and source modules", async ({ page }) => {
  await registerAndSignIn(page, "Reporting Polish");

  await page.goto("/reporting");

  await expect(page.getByRole("heading", { name: "Reporting y BI" })).toBeVisible();
  await expect(page.getByLabel("Periodo del informe")).toHaveValue("month");
  await expect(page.getByLabel("Periodo del informe")).toContainText("Este mes");
  await expect(page.getByTestId("reporting-kpi-explanation")).toContainText("KPIs calculados del tenant activo");
  await expect(page.getByTestId("reporting-source-links")).toContainText("Clientes");
  await expect(page.getByTestId("reporting-source-links")).toContainText("Facturas");
  await expect(page.getByTestId("reporting-source-links")).toContainText("Tesorería");

  const exportResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/reporting/export"));
  await page.getByRole("button", { name: "Exportar KPIs a Excel" }).click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  await expect(page.getByRole("status")).toContainText(/Excel (listo|descargado)/i);
});

test("onboarding only finishes from the final step and then points to concrete setup actions", async ({ page }) => {
  await registerAndSignIn(page, "Onboarding Polish");

  await page.goto("/onboarding");
  await page.getByLabel("Razón social").fill("Empresa onboarding polish S.L.");
  await expect(page.getByRole("button", { name: "Finalizar onboarding" })).toBeHidden();
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();

  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Paso 2 de 5")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Paso 3 de 5")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Paso 4 de 5")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Paso 5 de 5")).toBeVisible();

  const seedResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/onboarding/seed"));
  await page.getByRole("button", { name: "Finalizar onboarding" }).click();
  const seedResponse = await seedResponsePromise;
  expect(seedResponse.ok(), await seedResponse.text()).toBe(true);

  await expect(page.getByRole("status")).toContainText("Onboarding completado");
  await expect(page.getByRole("link", { name: "Crear primer cliente" })).toHaveAttribute("href", "/customers");
  await expect(page.getByRole("link", { name: "Volver al dashboard" })).toHaveAttribute("href", "/dashboard");
});
