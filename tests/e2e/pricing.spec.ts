import { expect, test, type Page } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.ok(), `GET ${path} failed with status ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
}

test("tarifas y grupos: la factura toma el precio de la tarifa y el descuento del grupo", async ({ page }) => {
  const runId = Date.now();
  await registerAndSignIn(page, "Tarifas E2E");
  await completeOnboarding(page, "Empresa tarifas E2E S.L.");
  await postJson(page, "/api/items", { sku: `CAF-${runId}`, name: "Café en grano", salePrice: 10 });
  await postJson(page, "/api/items", { sku: `TE-${runId}`, name: "Té verde", salePrice: 20 });

  // Tarifa con ajuste general del −10 % y un precio propio para el café.
  await page.goto("/settings/pricing");
  await page.getByRole("textbox", { name: "Código" }).first().fill("MAY");
  await page.getByRole("textbox", { name: "Nombre" }).first().fill("Mayoristas");
  await page.getByRole("textbox", { name: "Ajuste general (%)" }).fill("-10");
  await page.getByRole("button", { name: "Crear tarifa" }).click();
  await expect(page.getByRole("heading", { name: "Tarifa «Mayoristas»" })).toBeVisible();
  await page.getByTestId(`price-list-price-CAF-${runId}`).fill("7,50");
  await page.getByRole("button", { name: "Guardar tarifa" }).click();
  await expect(page.getByText("Tarifa guardada (1 precio(s) cambiados).")).toBeVisible();

  // Grupo con esa tarifa y un 5 % de descuento.
  await page.goto("/settings/pricing#grupos");
  await expect(page.getByTestId("price-lists")).toContainText("1 precio propio");
  await page.locator("#group-new-code").fill("DIST");
  await page.locator("#group-new-name").fill("Distribuidores");
  await page.locator("#group-new-list").selectOption({ label: "Mayoristas" });
  await page.locator("#group-new-discount").fill("5");
  await page.getByRole("button", { name: "Crear grupo" }).click();
  await expect(page.getByTestId("customer-group-DIST")).toBeVisible();

  const [group] = await getJson<Array<{ id: string; code: string }>>(page, "/api/customer-groups");
  const customer = await postJson<{ id: string }>(page, "/api/customers", {
    name: `Distribuidora ${runId}`,
    taxId: "B12345674",
    address: "Calle Precios 1",
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    countryCode: "ES",
    customerGroupId: group!.id,
  });

  await page.goto(`/invoices/new?customerId=${customer.id}`);
  await expect(page.getByTestId("invoice-pricing-hint")).toContainText("tarifa «Mayoristas» y 5 % de descuento del grupo «Distribuidores»");
  const item = page.getByTestId("invoice-line-1-item");
  await expect(async () => {
    await item.selectOption({ label: `CAF-${runId} · Café en grano` });
    await expect(page.getByTestId("invoice-line-1-unit-price")).toHaveValue(/^7[,.]50?$/, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId("invoice-line-1-description")).toHaveValue("Café en grano");
  await expect(page.getByTestId("invoice-line-1-discount")).toHaveValue(/^5([,.]0+)?$/);

  // Sin precio propio: precio de venta con el ajuste de la tarifa (20 − 10 % = 18).
  await page.getByTestId("invoice-add-line").click();
  await page.getByTestId("invoice-line-2-item").selectOption({ label: `TE-${runId} · Té verde` });
  await expect(page.getByTestId("invoice-line-2-unit-price")).toHaveValue(/^18([,.]0+)?$/);
});

test("series de gastos: elegir la serie del registro de facturas recibidas", async ({ page }) => {
  await registerAndSignIn(page, "Series gastos E2E");
  await completeOnboarding(page, "Empresa series gastos E2E S.L.");
  const series = await postJson<{ id: string }>(page, "/api/document-series", { type: "SUPPLIER_INVOICE", code: "IMP", name: "Importaciones", prefix: "IMP-" });

  await page.goto("/expenses/new");
  const manual = page.getByRole("button", { name: /a mano/i });
  if (await manual.isVisible().catch(() => false)) await manual.click();
  const select = page.getByTestId("expense-series-select");
  await expect(select).toBeVisible();
  await expect(select.locator("option:checked")).toContainText("por defecto");

  const created = await postJson<{ number: string }>(page, "/api/expenses", {
    supplierName: "Proveedor series E2E",
    supplierTaxId: "B12345674",
    issueDate: new Date().toISOString(),
    seriesId: series.id,
    lines: [{ description: "Material", quantity: 1, unitPrice: 50, taxRate: 21 }],
  });
  expect(created.number).toMatch(/^IMP-/);
});
