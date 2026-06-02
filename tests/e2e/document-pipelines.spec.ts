import { expect, type Page, test } from "@playwright/test";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

async function clickAndExpectPost<T = unknown>(page: Page, urlPart: string, click: () => Promise<unknown>): Promise<T> {
  const responsePromise = page.waitForResponse((response) => response.url().includes(urlPart) && response.request().method() === "POST");
  await click();
  const response = await responsePromise;
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  return (text ? JSON.parse(text) : null) as T;
}

test("sales pipeline guides quote to order to delivery to invoice", async ({ page }) => {
  const runId = Date.now();
  const customerName = `Cliente pipeline ${runId}`;
  const quoteNumber = `PRE-E2E-${runId}`;

  await registerAndSignIn(page, "Sales Pipeline E2E");
  await completeOnboarding(page, `Empresa pipeline ${runId} S.L.`);
  await postJson(page, "/api/warehouses", {
    code: `WH-${runId}`,
    name: `Almacén pipeline ${runId}`,
  });

  await page.goto("/customers");
  await page.getByLabel("Nombre").fill(customerName);
  await page.getByLabel("CIF/NIF/VAT").fill("B12345674");
  await page.getByLabel("Dirección fiscal").fill("Calle Pipeline 1");
  await page.getByLabel("Código postal").fill("28013");
  await page.getByLabel("Ciudad").fill("Madrid");
  await page.getByLabel("Provincia").fill("Madrid");
  await page.getByLabel("Email").fill(`cliente-pipeline-${runId}@example.test`);
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await expect(page.getByTestId("customers-table")).toContainText(customerName);

  const customerRow = page.getByTestId("customers-table").locator("tr", { hasText: customerName });
  await customerRow.getByRole("link", { name: "Crear presupuesto" }).click();
  await expect(page).toHaveURL(/\/sales\?customerId=/);
  await expect(page.getByLabel("Cliente para presupuesto")).toHaveValue(/.+/);

  await expect(page.getByTestId("sales-stage-quotes")).toContainText("Presupuestos");
  await expect(page.getByTestId("sales-stage-orders")).toContainText("Pedidos");
  await expect(page.getByTestId("sales-stage-delivery-notes")).toContainText("Albaranes");
  await expect(page.getByTestId("sales-stage-invoices")).toContainText("Facturas");
  await expect(page.getByText("No hay presupuestos convertibles")).toBeVisible();

  await page.getByPlaceholder("PRE-000001").fill(quoteNumber);
  await clickAndExpectPost(page, "/api/sales-quotes", () => page.getByRole("button", { name: "Crear presupuesto" }).click());
  await expect(page.getByTestId(`sales-transition-quote-${quoteNumber}`)).toContainText("Estado: DRAFT", { timeout: 15_000 });

  await clickAndExpectPost(page, "/to-order", () =>
    page.getByTestId(`sales-transition-quote-${quoteNumber}`).getByRole("button", { name: "Convertir a pedido" }).click(),
  );
  await expect(page.getByTestId("sales-stage-orders")).toContainText("1", { timeout: 15_000 });
  await expect(page.getByTestId("sales-transition-order").first()).toContainText("Estado: CONFIRMED", { timeout: 15_000 });

  await clickAndExpectPost(page, "/to-delivery", () =>
    page.getByTestId("sales-transition-order").first().getByRole("button", { name: "Generar albarán" }).click(),
  );
  await expect(page.getByTestId("sales-stage-delivery-notes")).toContainText("1", { timeout: 15_000 });
  await expect(page.getByTestId("sales-transition-delivery").first()).toContainText("Estado: DELIVERED", { timeout: 15_000 });

  const createdInvoice = await clickAndExpectPost<{ id: string; number: string; totalAmount: string }>(page, "/to-invoice", () =>
    page.getByTestId("sales-transition-delivery").first().getByRole("button", { name: "Generar factura" }).click(),
  );
  await expect(page.getByTestId("sales-stage-invoices")).toContainText("1", { timeout: 15_000 });
  await expect(page.getByText("Bloqueado: Este albarán ya fue facturado.")).toBeVisible();

  await page.getByRole("link", { name: "Ir a facturas" }).click();
  await expect(page.getByTestId("invoices-list")).toContainText(createdInvoice.number, { timeout: 15_000 });
  const invoiceRow = page.getByTestId(`invoice-row-${createdInvoice.id}`);
  await expect(invoiceRow).toContainText("PENDING");
  await invoiceRow.getByRole("link", { name: "Registrar cobro" }).click();

  await expect(page).toHaveURL(new RegExp(`/treasury\\?invoiceId=${createdInvoice.id}`));
  await expect(page.getByTestId(`customer-cash-invoice-${createdInvoice.id}`)).toContainText("PENDING");

  await page.getByLabel("Importe cobrado").fill("0");
  const failedPayment = page.waitForResponse((response) => response.url().includes("/api/invoice-payments") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Registrar cobro" }).click();
  const failedPaymentResponse = await failedPayment;
  expect(failedPaymentResponse.status()).toBe(400);
  await expect(page.getByRole("alert").filter({ hasText: "Datos inválidos." })).toBeVisible();
  await expect(page.getByTestId(`customer-cash-invoice-${createdInvoice.id}`)).toContainText("PENDING");

  await page.getByLabel("Importe cobrado").fill(createdInvoice.totalAmount.toString());
  await clickAndExpectPost(page, "/api/invoice-payments", () => page.getByRole("button", { name: "Registrar cobro" }).click());
  await expect(page.getByTestId(`customer-cash-invoice-${createdInvoice.id}`)).toContainText("PAID", { timeout: 15_000 });

  await page.getByRole("link", { name: "Ver reporting de cobros" }).click();
  await expect(page.getByTestId("customer-to-cash-report")).toContainText("Facturas cobradas");
  await expect(page.getByTestId("customer-to-cash-report")).toContainText("1");
});
