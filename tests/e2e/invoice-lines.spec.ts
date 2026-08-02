import { expect, test } from "@playwright/test";

import { patchJson, postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("crear customer y factura con dos líneas persiste totales y líneas", async ({ page }) => {
  const runId = Date.now();
  const customerName = `Cliente líneas ${runId}`;

  await registerAndSignIn(page, "Invoice Lines E2E");
  await completeOnboarding(page, "Empresa líneas E2E S.L.");
  const bankAccount = await postJson<{ id: string }>(page, "/api/bank-accounts", {
    bankName: "Banco factura",
    iban: "ES12 3456 7890 1234 5678 9012",
  });
  const secondaryPaymentMethod = await postJson<{
    id: string;
    name: string;
    type: "CARD";
  }>(page, "/api/payment-methods", {
    code: `CARD-${runId}`,
    name: "Pago con tarjeta",
    type: "CARD",
    bankAccountId: "",
    bankAccountNumber: "",
    isDefault: false,
  });
  const paymentMethodsResponse = await page.request.get("/api/payment-methods");
  expect(paymentMethodsResponse.ok()).toBeTruthy();
  const configuredPaymentMethods = (await paymentMethodsResponse.json()) as Array<{
    id: string;
    bankAccountId: string | null;
    code: string;
    name: string;
    type: "BANK_TRANSFER" | "CARD" | "CASH" | "DIRECT_DEBIT";
    bankAccountNumber: string | null;
    isDefault: boolean;
  }>;
  const linkedPaymentMethod = configuredPaymentMethods.find((method) => method.bankAccountId === bankAccount.id);
  expect(linkedPaymentMethod).toBeTruthy();
  await patchJson(page, `/api/payment-methods/${linkedPaymentMethod!.id}`, {
    ...linkedPaymentMethod,
    name: "Transferencia factura",
    isDefault: true,
  });
  await page.goto("/settings/masters");
  await expect(page.getByText("Formas de pago", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Nombre Transferencia factura")).toHaveValue("Transferencia factura");
  await expect(page.getByText("ES12 3456 7890 1234 5678 9012", { exact: true })).toBeVisible();

  await page.goto("/customers/new");
  await page.getByLabel("Nombre").fill(customerName);
  await page.getByLabel("CIF/NIF/VAT").fill("B12345674");
  await page.getByLabel("Dirección fiscal").fill("Calle Líneas 1");
  await page.getByLabel("Código postal").fill("28013");
  await page.getByLabel("Ciudad").fill("Madrid");
  await page.getByLabel("Provincia").fill("Madrid");
  await page.getByLabel("Email").fill(`cliente-${runId}@example.test`);
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await expect(page.locator("tr", { hasText: customerName })).toBeVisible();

  await page.goto("/invoices/new");
  await expect(page.getByTestId("invoice-issue-date-input")).not.toHaveValue("");
  await page.getByRole("button", { name: "Buscar cliente" }).click();
  await page.getByLabel("Nombre, email o teléfono").fill(customerName);
  await page.getByRole("button", { name: new RegExp(customerName) }).click();
  await page.getByTestId("invoice-issue-date-input").fill("2026-05-09");
  const createPaymentMethods = page.getByTestId("invoice-payment-methods-picker");
  await createPaymentMethods.locator("summary").click();
  await expect(createPaymentMethods.locator(`input[value="${linkedPaymentMethod!.id}"]`)).toBeChecked();
  await createPaymentMethods.locator(`input[value="${secondaryPaymentMethod.id}"]`).check();

  await page.getByTestId("invoice-line-1-description").fill("Consultoría");
  await page.getByTestId("invoice-line-1-quantity").fill("2");
  await page.getByTestId("invoice-line-1-unit-price").fill("100");
  await page.getByTestId("invoice-line-1-taxes").locator("summary").click();
  await page.getByTestId("invoice-line-1-taxes").getByRole("checkbox", { name: /IVA general/ }).check();

  await page.getByTestId("invoice-line-1-unit-price").press("Enter");
  await expect(page.getByTestId("invoice-line-2-description")).toBeFocused();
  await page.getByTestId("invoice-line-2-description").fill("Soporte");
  await page.getByTestId("invoice-line-2-quantity").fill("1.5");
  await page.getByTestId("invoice-line-2-unit-price").fill("80");
  await page.getByTestId("invoice-line-2-taxes").locator("summary").click();
  await page.getByTestId("invoice-line-2-taxes").getByRole("checkbox", { name: /IVA reducido/ }).check();

  await page.getByRole("button", { name: "Duplicar línea 2" }).click();
  await expect(page.getByTestId("invoice-line-3-description")).toHaveValue("Soporte");
  await page.getByRole("button", { name: "Eliminar línea 3" }).click();
  await page.getByRole("button", { name: "Subir línea 2" }).click();
  await expect(page.getByTestId("invoice-line-1-description")).toHaveValue("Soporte");
  await page.getByRole("button", { name: "Bajar línea 1" }).click();
  await expect(page.getByTestId("invoice-line-1-description")).toHaveValue("Consultoría");

  await expect(page.getByText("Subtotal: 320,00 €")).toBeVisible();
  await expect(page.getByTestId("invoice-tax-total")).toHaveText("Impuestos añadidos: 54,00 €");
  await expect(page.getByText("Total: 374,00 €")).toBeVisible();

  const invoiceResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/invoices") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Crear factura" }).click();
  const invoiceResponse = await invoiceResponsePromise;
  expect(invoiceResponse.ok()).toBe(true);
  const createdInvoice = (await invoiceResponse.json()) as { id: string; number: string };
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole("heading", { name: createdInvoice.number })).toBeVisible();
  await expect(page.getByText("Transferencia factura", { exact: true })).toBeVisible();
  await expect(page.getByText("ES12 3456 7890 1234 5678 9012", { exact: false })).toBeVisible();

  await page.goto("/invoices");
  const invoiceRow = page.locator("tr", { hasText: createdInvoice.number });
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
  expect(payload.paymentMethodName).toBe("Transferencia factura");
  expect(payload.paymentMethodType).toBe("BANK_TRANSFER");
  expect(payload.paymentBankAccountNumber).toBe("ES12 3456 7890 1234 5678 9012");
  expect(payload.paymentMethods).toMatchObject([
    { id: linkedPaymentMethod!.id, name: "Transferencia factura", position: 0 },
    { id: secondaryPaymentMethod.id, name: secondaryPaymentMethod.name, position: 1 },
  ]);
  expect(payload.lines).toMatchObject([
    { description: "Consultoría", quantity: "2.000", unitPrice: "100.00", taxRate: "21.000", lineTotal: "242.00" },
    { description: "Soporte", quantity: "1.500", unitPrice: "80.00", taxRate: "10.000", lineTotal: "132.00" },
  ]);

  const pdfResponse = await page.request.get(`/api/invoices/${invoiceId}/pdf`);
  expect(pdfResponse.ok()).toBeTruthy();
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
  expect((await pdfResponse.body()).subarray(0, 4).toString()).toBe("%PDF");

  const replacementCustomer = await postJson<{ id: string }>(page, "/api/customers", {
    name: `Cliente corregido ${runId}`,
    taxId: "B87654321",
    address: "Calle Corrección 2",
    postalCode: "28014",
    city: "Madrid",
    province: "Madrid",
    countryCode: "ES",
    email: `corregido-${runId}@example.test`,
    phone: "910000002",
  });
  await page.goto(editHref!);
  await expect(page.getByTestId("invoice-edit-issue-date-input")).toHaveValue("2026-05-09");
  await expect(page.getByTestId("invoice-edit-due-date-input")).toHaveValue("");
  const editPaymentMethods = page.getByTestId("invoice-payment-methods-picker");
  await editPaymentMethods.locator("summary").click();
  await expect(editPaymentMethods.locator(`input[value="${linkedPaymentMethod!.id}"]`)).toBeChecked();
  await expect(editPaymentMethods.locator(`input[value="${secondaryPaymentMethod.id}"]`)).toBeChecked();
  await editPaymentMethods.locator(`input[value="${secondaryPaymentMethod.id}"]`).uncheck();
  await page.getByRole("button", { name: "Buscar cliente" }).click();
  await page.getByLabel("CIF/NIF/VAT").fill("B87654321");
  await page.getByRole("button", { name: /Cliente corregido/ }).click();
  await page.getByTestId("invoice-edit-issue-date-input").fill("2026-05-10");
  await page.getByTestId("invoice-edit-due-date-input").fill("2026-06-10");
  const updateResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith(`/api/invoices/${invoiceId}`) && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  expect((await updateResponsePromise).ok()).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`));

  const updatedInvoice = await page.request.get(`/api/invoices/${invoiceId}`);
  expect(updatedInvoice.ok()).toBeTruthy();
  const updatedPayload = (await updatedInvoice.json()) as { customerId: string; issueDate: string; dueDate: string; paymentMethods: Array<{ id: string | null }> };
  expect(updatedPayload.customerId).toBe(replacementCustomer.id);
  expect(updatedPayload.issueDate).toMatch(/^2026-05-10/);
  expect(updatedPayload.dueDate).toMatch(/^2026-06-10/);
  expect(updatedPayload.paymentMethods).toEqual(expect.arrayContaining([{ id: linkedPaymentMethod!.id, name: "Transferencia factura", type: "BANK_TRANSFER", bankAccountNumber: "ES12 3456 7890 1234 5678 9012", position: 0 }]));
  expect(updatedPayload.paymentMethods).toHaveLength(1);
});

test("crear factura permite crear cliente fiscal inline si no existe", async ({ page }) => {
  const runId = Date.now();
  const customerName = `Cliente inline ${runId}`;

  await registerAndSignIn(page, "Invoice Inline Customer E2E");
  await completeOnboarding(page, "Empresa inline E2E S.L.");

  await page.goto("/invoices/new");
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
  await expect(page.getByText(customerName)).toBeVisible();
  await page.getByTestId("invoice-issue-date-input").fill("2026-05-09");
  await page.getByTestId("invoice-line-1-description").fill("Servicio inline");
  await page.getByTestId("invoice-line-1-quantity").fill("1");
  await page.getByTestId("invoice-line-1-unit-price").fill("100");
  await page.getByTestId("invoice-line-1-taxes").locator("summary").click();
  await page.getByTestId("invoice-line-1-taxes").getByRole("checkbox", { name: /IVA general/ }).check();

  const invoiceResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/invoices") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Crear factura" }).click();
  const invoiceResponse = await invoiceResponsePromise;
  expect(invoiceResponse.ok()).toBe(true);
  const createdInvoice = (await invoiceResponse.json()) as { number: string };
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole("heading", { name: createdInvoice.number })).toBeVisible();

  await page.goto("/invoices");
  const invoiceRow = page.locator("tr", { hasText: createdInvoice.number });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow.getByText(customerName)).toBeVisible();
});
