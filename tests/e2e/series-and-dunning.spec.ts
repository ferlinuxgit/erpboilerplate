import { expect, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("series de facturas: crear una serie de tickets y elegirla al crear la factura", async ({ page }) => {
  await registerAndSignIn(page, "Series E2E");
  await completeOnboarding(page, "Empresa series E2E S.L.");

  await page.goto("/settings/masters");
  await expect(page.getByRole("heading", { name: "Series de numeración" })).toBeVisible();
  await expect(page.getByTestId("invoice-series-preview")).toBeVisible();
  const createForm = page.getByTestId("series-create-form");
  await createForm.getByLabel("Código").fill("T");
  await createForm.getByLabel("Nombre").fill("Tickets");
  await createForm.getByLabel("Prefijo").fill("T-");
  await createForm.getByRole("button", { name: "Crear serie" }).click();
  await expect(page.getByTestId("series-row-T")).toBeVisible();

  await page.goto("/invoices/new");
  const seriesSelect = page.getByTestId("invoice-series-select");
  await expect(seriesSelect).toBeVisible();
  await expect(seriesSelect.locator("option:checked")).toContainText("por defecto");
  await seriesSelect.selectOption({ label: "Tickets (T)" });
  await expect(page.getByTestId("invoice-number-preview")).toContainText("«Tickets»");
  await expect(page.getByTestId("invoice-number-preview")).toContainText("T-");
});

test("ficha del cliente: no enviar recordatorios de cobro", async ({ page }) => {
  const runId = Date.now();
  await registerAndSignIn(page, "Dunning opt-out E2E");
  await completeOnboarding(page, "Empresa recordatorios E2E S.L.");
  const created = await postJson<{ id: string }>(page, "/api/customers", {
    name: `Cliente recordatorios ${runId}`,
    taxId: "B12345674",
    address: "Calle Cobros 1",
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    countryCode: "ES",
    email: `cobros-${runId}@example.test`,
  });

  await page.goto(`/customers/${created.id}`);
  const toggle = page.getByTestId("customer-dunning-opt-out").getByRole("checkbox", { name: "No enviar recordatorios de cobro" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByText(/no recibirá recordatorios de cobro/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("customer-dunning-opt-out").getByRole("checkbox")).toBeChecked();

  await page.goto(`/customers/${created.id}/edit`);
  await expect(page.getByLabel("No enviar recordatorios de cobro")).toBeChecked();
});
