import { expect, test } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("crear customer y factura con dos líneas persiste totales y líneas", async ({ page }) => {
  const runId = Date.now();
  const customerName = `Cliente líneas ${runId}`;
  const invoiceNumber = `FAC-E2E-${runId}`;

  await registerAndSignIn(page, "Invoice Lines E2E");
  await completeOnboarding(page, "Empresa líneas E2E S.L.");

  await page.goto("/customers");
  await page.getByLabel("Nombre").fill(customerName);
  await page.getByLabel("CIF/NIF/VAT").fill("B12345674");
  await page.getByLabel("Dirección fiscal").fill("Calle Líneas 1");
  await page.getByLabel("Código postal").fill("28013");
  await page.getByLabel("Ciudad").fill("Madrid");
  await page.getByLabel("Provincia").fill("Madrid");
  await page.getByLabel("Email").fill(`cliente-${runId}@example.test`);
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await expect(page.locator("tr", { hasText: customerName })).toBeVisible();

  await page.goto("/invoices");
  await page.getByTestId("invoice-customer-select").selectOption({ label: customerName });
  await page.getByTestId("invoice-number-input").fill(invoiceNumber);
  await page.getByTestId("invoice-issue-date-input").fill("2026-05-09");

  await page.getByTestId("invoice-line-1-description").fill("Consultoría");
  await page.getByTestId("invoice-line-1-quantity").fill("2");
  await page.getByTestId("invoice-line-1-unit-price").fill("100");
  await page.getByTestId("invoice-line-1-tax-rate").fill("21");

  await page.keyboard.press("Alt+L");
  await page.getByTestId("invoice-line-2-description").fill("Soporte");
  await page.getByTestId("invoice-line-2-quantity").fill("1.5");
  await page.getByTestId("invoice-line-2-unit-price").fill("80");
  await page.getByTestId("invoice-line-2-tax-rate").fill("10");

  await expect(page.getByText("Subtotal: 320,00 €")).toBeVisible();
  await expect(page.getByText("IVA: 54,00 €")).toBeVisible();
  await expect(page.getByText("Total: 374,00 €")).toBeVisible();

  await page.getByRole("button", { name: "Crear factura" }).click();
  const invoiceRow = page.locator("tr", { hasText: invoiceNumber });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow.getByText(customerName)).toBeVisible();
  await expect(invoiceRow.getByText("374,00 €")).toBeVisible();

  const editHref = await invoiceRow.getByRole("link", { name: "Editar" }).getAttribute("href");
  const invoiceId = editHref?.match(/\/invoices\/(.+)\/edit/)?.[1];
  expect(invoiceId).toBeTruthy();

  const persisted = await page.request.get(`/api/invoices/${invoiceId}`);
  expect(persisted.ok()).toBeTruthy();
  await expect(persisted).toBeOK();
  const payload = await persisted.json();
  expect(payload.totalAmount).toBe("374.00");
  expect(payload.lines).toMatchObject([
    { description: "Consultoría", quantity: "2.000", unitPrice: "100.00", taxRate: "21.000", lineTotal: "242.00" },
    { description: "Soporte", quantity: "1.500", unitPrice: "80.00", taxRate: "10.000", lineTotal: "132.00" },
  ]);
});

test("crear factura permite crear cliente fiscal inline si no existe", async ({ page }) => {
  const runId = Date.now();
  const customerName = `Cliente inline ${runId}`;
  const invoiceNumber = `FAC-INLINE-${runId}`;

  await registerAndSignIn(page, "Invoice Inline Customer E2E");
  await completeOnboarding(page, "Empresa inline E2E S.L.");

  await page.goto("/invoices");
  const newCustomerButton = page.getByTestId("invoice-new-customer-toggle");
  await expect(newCustomerButton).toBeVisible();
  await newCustomerButton.focus();
  await expect(newCustomerButton).toBeFocused();
  await page.keyboard.press("Enter");
  if (!(await page.getByTestId("invoice-new-customer-name-input").isVisible().catch(() => false))) {
    await newCustomerButton.focus();
    await page.keyboard.press("Space");
  }
  await expect(page.getByTestId("invoice-new-customer-name-input")).toBeVisible();
  await page.getByTestId("invoice-new-customer-name-input").fill(customerName);
  await page.getByTestId("invoice-new-customer-tax-id-input").fill("B12345674");
  await page.getByTestId("invoice-new-customer-address-input").fill("Calle Inline 1");
  await page.getByTestId("invoice-new-customer-postal-code-input").fill("28013");
  await page.getByTestId("invoice-new-customer-city-input").fill("Madrid");
  await page.getByTestId("invoice-new-customer-province-input").fill("Madrid");
  await page.getByTestId("invoice-new-customer-submit").click();
  await expect(page.getByTestId("invoice-customer-select")).toHaveValue(/.+/);
  await page.getByTestId("invoice-number-input").fill(invoiceNumber);
  await page.getByTestId("invoice-issue-date-input").fill("2026-05-09");
  await page.getByTestId("invoice-line-1-description").fill("Servicio inline");
  await page.getByTestId("invoice-line-1-quantity").fill("1");
  await page.getByTestId("invoice-line-1-unit-price").fill("100");
  await page.getByTestId("invoice-line-1-tax-rate").fill("21");

  await page.getByRole("button", { name: "Crear factura" }).click();
  const invoiceRow = page.locator("tr", { hasText: invoiceNumber });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow.getByText(customerName)).toBeVisible();
});
