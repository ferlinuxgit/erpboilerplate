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

test("sales documents progress from quote to order, delivery note and invoice", async ({ page }) => {
  const runId = Date.now();
  const customerName = `Cliente pipeline ${runId}`;
  const quoteNumber = `PRE-E2E-${runId}`;

  await registerAndSignIn(page, "Sales Pipeline E2E");
  await completeOnboarding(page, `Empresa pipeline ${runId} S.L.`);
  await postJson(page, "/api/payment-methods", {
    code: `COBRO-${runId}`,
    name: "Transferencia",
    type: "BANK_TRANSFER",
  });
  await postJson(page, "/api/warehouses", {
    code: `WH-${runId}`,
    name: `Almacén pipeline ${runId}`,
  });

  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Ventas", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver listado" })).toHaveCount(3);
  await expect(page.getByText("Continuidad del journey")).toHaveCount(0);

  await page.goto("/customers/new");
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
  await expect(page).toHaveURL(/\/sales\/new\?customerId=/);
  await expect(page.getByLabel("Cliente")).toHaveValue(/.+/);
  await page.getByLabel("Número").fill(quoteNumber);
  await page.getByLabel("Concepto").fill("Servicio de implantación");
  await page.getByLabel("Precio unitario").fill("100");
  await clickAndExpectPost(page, "/api/sales-quotes", () => page.getByRole("button", { name: "Crear presupuesto" }).click());
  await expect(page).toHaveURL(/\/sales\/quotes$/);
  await expect(page.getByTestId("sales-quotes-list")).toContainText(quoteNumber);
  await page.getByTestId("sales-quotes-list").getByRole("link", { name: quoteNumber }).click();
  await expect(page).toHaveURL(/\/sales\/quotes\/.+/, { timeout: 15_000 });
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();

  await clickAndExpectPost(page, "/to-order", () => page.getByRole("button", { name: "Convertir a pedido" }).click());
  await expect(page).toHaveURL(/\/sales\/orders\/.+/, { timeout: 15_000 });
  await expect(page.getByText("Confirmado", { exact: true })).toBeVisible();

  await clickAndExpectPost(page, "/to-delivery", () => page.getByRole("button", { name: "Generar albarán" }).click());
  await expect(page).toHaveURL(/\/sales\/delivery-notes\/.+/, { timeout: 15_000 });
  await expect(page.getByText("Entregado", { exact: true }).first()).toBeVisible();

  const createdInvoice = await clickAndExpectPost<{ id: string; number: string; totalAmount: string }>(page, "/to-invoice", () =>
    page.getByRole("button", { name: "Generar factura" }).click(),
  );
  await expect(page).toHaveURL(new RegExp(`/invoices/${createdInvoice.id}$`), { timeout: 15_000 });
  await page.goto("/invoices");
  await expect(page.getByTestId("invoices-list")).toContainText(createdInvoice.number, { timeout: 15_000 });
  const invoiceRow = page.getByTestId(`invoice-row-${createdInvoice.id}`);
  await expect(invoiceRow).toContainText("Pendiente");
  await invoiceRow.getByRole("button", { name: "Registrar cobro" }).click();

  const paymentDialog = page.getByRole("dialog", { name: new RegExp(`Registrar cobro ${createdInvoice.number}`) });
  await expect(paymentDialog).toBeVisible();

  await paymentDialog.getByLabel("Importe cobrado").fill("0");
  const failedPayment = page.waitForResponse((response) => response.url().includes("/api/invoice-payments") && response.request().method() === "POST");
  await paymentDialog.getByRole("button", { name: "Registrar cobro" }).click();
  const failedPaymentResponse = await failedPayment;
  expect(failedPaymentResponse.status()).toBe(400);
  await expect(page.getByRole("alert").filter({ hasText: "Datos inválidos." })).toBeVisible();

  await paymentDialog.getByLabel("Importe cobrado").fill(createdInvoice.totalAmount.toString());
  await clickAndExpectPost(page, "/api/invoice-payments", () => paymentDialog.getByRole("button", { name: "Registrar cobro" }).click());
  await expect(invoiceRow).toContainText("Pagada", { timeout: 15_000 });

  await page.goto("/treasury#customer-to-cash-report");
  await expect(page.getByTestId("customer-to-cash-report")).toContainText("Facturas cobradas");
  await expect(page.getByTestId("customer-to-cash-report")).toContainText("1");
});
