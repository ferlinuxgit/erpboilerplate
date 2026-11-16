import { expect, test } from "@playwright/test";

import { patchJson } from "./helpers/api-client";
import { registerAndSignIn } from "./helpers/authenticated-session";

test("a French company is configured from its VAT number: TVA rates and a generic tax summary instead of the AEAT models", async ({ page }) => {
  // Recorrido largo: alta completa (plan contable del país) y dos pantallas fiscales.
  test.setTimeout(240_000);
  await registerAndSignIn(page, "Country Pack FR");

  await page.goto("/onboarding");
  await expect(page.getByLabel("País de la empresa")).toHaveValue("ES");

  await page.getByLabel("Nombre o razón social").fill("Atelier Dupont SARL");
  // El país se deduce del prefijo del NIF-IVA: no hay que elegirlo.
  await page.getByLabel("NIF/CIF").fill("FR40303265045");
  await expect(page.getByLabel("País de la empresa")).toHaveValue("FR");
  await expect(page.getByLabel("NIF-IVA")).toHaveValue("FR40303265045");
  await page.getByRole("radio", { name: /Servicios/ }).first().check();
  const stepSave = page.waitForResponse((response) => response.url().endsWith("/api/onboarding") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  expect((await stepSave).ok()).toBe(true);
  await expect(page.getByText("Paso 2 de 4")).toBeVisible();

  // Código postal libre y región opcional fuera de España.
  await page.getByRole("textbox", { name: "Dirección fiscal" }).fill("1 rue de Rivoli");
  await page.getByLabel("Código postal").fill("75001");
  await page.getByLabel("Ciudad").fill("Paris");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(page.getByText("Paso 3 de 4")).toBeVisible();

  await page.getByLabel("Prefijo de tus facturas").fill("F");
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  await expect(page.getByText("Paso 4 de 4")).toBeVisible({ timeout: 30_000 });
  const seedResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/onboarding/seed"));
  await page.getByRole("button", { name: "Finalizar sin invitar" }).click();
  const seedResponse = await seedResponsePromise;
  expect(seedResponse.ok(), await seedResponse.text()).toBe(true);

  // Fiscalidad: resumen de TVA en lugar de los modelos de la AEAT.
  await page.goto("/fiscal");
  await expect(page.getByRole("heading", { level: 1, name: "Impuestos · Francia" })).toBeVisible();
  await expect(page.getByText("Resumen de TVA").first()).toBeVisible();
  await expect(page.getByTestId("context-navigation").getByRole("link", { name: "VERI*FACTU" })).toHaveCount(0);
  await expect(page.getByTestId("context-navigation").getByRole("link", { name: "Resumen de impuestos" })).toBeVisible();

  // Impuestos del país creados solos y sin opciones españolas.
  await page.goto("/settings/fiscal");
  await expect(page.getByText("Fiscalidad de Francia: configuración automática")).toBeVisible();
  await expect(page.getByText("TVA general 20%").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "VERI*FACTU" })).toHaveCount(0);
  await expect(page.getByLabel("Régimen de IVA")).toHaveCount(0);
});

test("the Spanish tax screens redirect to the tax summary for companies from other countries", async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndSignIn(page, "Country Pack PT");
  // Sin facturas emitidas, la empresa puede cambiar de país (adopta el paquete de Portugal).
  await patchJson(page, "/api/onboarding", { countryCode: "PT" });

  await page.goto("/fiscal/verifactu");
  await expect(page).toHaveURL(/\/fiscal$/);
  await expect(page.getByRole("heading", { level: 1, name: "Impuestos · Portugal" })).toBeVisible();
  await page.goto("/fiscal/new");
  await expect(page).toHaveURL(/\/fiscal$/);
});
