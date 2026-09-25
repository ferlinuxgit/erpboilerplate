import { expect, test } from "@playwright/test";

import { registerAndSignIn } from "./helpers/authenticated-session";

test("reporting guides users through period, KPI context, export status, and source modules", async ({ page }) => {
  await registerAndSignIn(page, "Reporting Polish");

  await page.goto("/reporting");

  await expect(page.getByRole("heading", { name: "Informes", exact: true })).toBeVisible();
  await expect(page.getByLabel("Periodo del informe")).toHaveValue("month");
  await expect(page.getByLabel("Periodo del informe")).toContainText("Este mes");
  await expect(page.getByTestId("reporting-kpi-explanation")).toContainText("Indicadores calculados del espacio activo");
  await expect(page.getByTestId("reporting-source-links")).toContainText("Clientes");
  await expect(page.getByTestId("reporting-source-links")).toContainText("Facturas");
  await expect(page.getByTestId("reporting-source-links")).toContainText("Tesorería");

  const exportResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/reporting/export"));
  await page.getByRole("button", { name: "Exportar indicadores a Excel" }).click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.ok(), await exportResponse.text()).toBe(true);
  // The shell has its own (usually empty) live region for keyboard sequences: filter by text.
  await expect(page.getByRole("status").filter({ hasText: /Excel (listo|descargado)/i })).toBeVisible();
});

test("setup wizard saves each step, only finishes from the last one and points to concrete next actions", async ({ page }) => {
  await registerAndSignIn(page, "Onboarding Polish");

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { level: 1, name: "Puesta en marcha" })).toBeVisible();
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  await expect(page.getByRole("button", { name: /Finalizar/ })).toBeHidden();

  // Required fields are enforced before moving on.
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(page.getByText("Revisa los datos marcados para continuar.")).toBeVisible();
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();

  await page.getByLabel("Nombre o razón social").fill("Empresa onboarding polish S.L.");
  await page.getByLabel("NIF/CIF").fill("B12345674");
  await page.getByRole("radio", { name: /Servicios/ }).first().check();
  const stepSave = page.waitForResponse((response) => response.url().endsWith("/api/onboarding") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  expect((await stepSave).ok()).toBe(true);
  await expect(page.getByText("Paso 2 de 4")).toBeVisible();

  await page.getByLabel("Dirección fiscal").fill("Calle Mayor 1");
  await page.getByLabel("Código postal").fill("28013");
  await page.getByLabel("Ciudad").fill("Madrid");
  await page.getByLabel("Provincia").fill("Madrid");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(page.getByText("Paso 3 de 4")).toBeVisible();

  await page.getByLabel("Prefijo de tus facturas").fill("F");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(page.getByText("Paso 4 de 4")).toBeVisible({ timeout: 30_000 });

  // The invitation is really created; without SMTP the link is shown to copy.
  await page.getByLabel("Email de tu gestor o de la persona a invitar").fill(`gestor-${Date.now()}@example.test`);
  const seedResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/onboarding/seed"));
  await page.getByRole("button", { name: "Invitar y finalizar" }).click();
  const seedResponse = await seedResponsePromise;
  expect(seedResponse.ok(), await seedResponse.text()).toBe(true);
  const seedPayload = (await seedResponse.json()) as { invitation: { url: string } | null };
  expect(seedPayload.invitation?.url).toMatch(/\/invitations\//);

  await expect(page.getByRole("status").filter({ hasText: "Tu empresa está lista para facturar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar enlace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Crear primer cliente" })).toHaveAttribute("href", "/customers/new");
  await expect(page.getByRole("link", { name: "Ir al panel" })).toHaveAttribute("href", "/dashboard");

  // Service business: stock-only modules leave the navigation (still reachable from search).
  await page.goto("/dashboard");
  await expect(page.getByTestId("nav-link-inventory")).toHaveCount(0);
  await expect(page.getByTestId("nav-link-invoices").first()).toBeVisible();
});
