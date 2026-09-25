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
  // Las líneas nuevas proponen el IVA por defecto (21 %): se cambia por el reducido.
  await page.getByTestId("invoice-line-2-taxes").getByRole("checkbox", { name: /IVA general/ }).uncheck();
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
  // 1) Guardar como borrador: número provisional, editable, sin asiento.
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  const invoiceResponse = await invoiceResponsePromise;
  expect(invoiceResponse.ok()).toBe(true);
  const createdInvoice = (await invoiceResponse.json()) as { id: string; number: string; lifecycle: string };
  expect(createdInvoice.lifecycle).toBe("DRAFT");
  expect(createdInvoice.number).toMatch(/^BORRADOR-/);
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole("heading", { name: createdInvoice.number })).toBeVisible();
  await expect(page.getByTestId("invoice-draft-notice")).toBeVisible();
  await expect(page.getByText("Transferencia factura", { exact: true })).toBeVisible();
  await expect(page.getByText("ES12 3456 7890 1234 5678 9012", { exact: false })).toBeVisible();

  await page.goto("/invoices");
  // Los borradores se listan como "Borrador" (sin el código provisional BORRADOR-…) y sin pendiente de cobro.
  const invoiceRow = page.getByTestId(`invoice-row-${createdInvoice.id}`);
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow).not.toContainText(createdInvoice.number);
  await expect(invoiceRow.getByRole("link", { name: "Borrador", exact: true })).toBeVisible();
  await expect(invoiceRow.getByText(customerName)).toBeVisible();
  await expect(invoiceRow.getByText("374,00 €").first()).toBeVisible();

  await invoiceRow.getByRole("button", { name: /Más acciones de/ }).click();
  const editHref = await invoiceRow.getByRole("menuitem", { name: "Editar" }).getAttribute("href");
  const invoiceId = editHref?.match(/\/invoices\/(.+)\/edit/)?.[1];
  expect(invoiceId).toBeTruthy();

  const persisted = await page.request.get(`/api/invoices/${invoiceId}`);
  expect(persisted.ok()).toBeTruthy();
  await expect(persisted).toBeOK();
  const payload = await persisted.json();
  expect(payload.lifecycle).toBe("DRAFT");
  expect(payload.vatTreatment).toBe("DOMESTIC");
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

  // 2) Mientras es borrador se puede editar todo (cliente, fechas, líneas, formas de pago).
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
  // Vencimiento propuesto automáticamente: emisión + 30 días (plazo de la empresa).
  await expect(page.getByTestId("invoice-edit-due-date-input")).toHaveValue("2026-06-08");
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
  await page.getByTestId("invoice-line-1-description").fill("");
  await page.getByTestId("invoice-edit-submit").click();
  await expect(page.getByTestId("invoice-edit-error")).toContainText("Revisa las líneas de la factura");
  await expect(page.getByTestId("invoice-line-1-description")).toBeFocused();
  await page.getByTestId("invoice-line-1-description").fill("Consultoría corregida");
  const updateResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith(`/api/invoices/${invoiceId}`) && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  expect((await updateResponsePromise).ok()).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`));

  const updatedInvoice = await page.request.get(`/api/invoices/${invoiceId}`);
  expect(updatedInvoice.ok()).toBeTruthy();
  const updatedPayload = (await updatedInvoice.json()) as {
    customerId: string;
    issueDate: string;
    dueDate: string;
    lines: Array<{ description: string }>;
    paymentMethods: Array<{ id: string | null }>;
  };
  expect(updatedPayload.customerId).toBe(replacementCustomer.id);
  expect(updatedPayload.issueDate).toMatch(/^2026-05-10/);
  expect(updatedPayload.dueDate).toMatch(/^2026-06-10/);
  expect(updatedPayload.lines[0]?.description).toBe("Consultoría corregida");
  expect(updatedPayload.paymentMethods).toEqual(expect.arrayContaining([{ id: linkedPaymentMethod!.id, name: "Transferencia factura", type: "BANK_TRANSFER", bankAccountNumber: "ES12 3456 7890 1234 5678 9012", position: 0 }]));
  expect(updatedPayload.paymentMethods).toHaveLength(1);

  // 3) Emitir: número definitivo de la serie y snapshot fiscal del cliente.
  const issueResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith(`/api/invoices/${invoiceId}/issue`) && response.request().method() === "POST",
  );
  await page.getByTestId("invoice-issue-button").click();
  await page.getByTestId("invoice-issue-confirm").click();
  const issueResponse = await issueResponsePromise;
  expect(issueResponse.ok()).toBe(true);
  const issuedInvoice = (await issueResponse.json()) as { number: string };
  expect(issuedInvoice.number).not.toMatch(/^BORRADOR-/);
  await expect(page.getByRole("heading", { name: issuedInvoice.number })).toBeVisible();

  const issuedPayload = await (await page.request.get(`/api/invoices/${invoiceId}`)).json();
  expect(issuedPayload.lifecycle).toBe("ISSUED");
  expect(issuedPayload.status).toBe("SENT");
  expect(issuedPayload.customerSnapshot).toMatchObject({ name: `Cliente corregido ${runId}`, taxId: "B87654321" });

  // 4) Una factura emitida es inmutable: la API rechaza cambiar sus líneas.
  const lockedPatch = await page.evaluate(async ({ id }) => {
    const csrfToken = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1];
    const response = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {}) },
      body: JSON.stringify({ lines: [{ description: "Cambio", quantity: 1, unitPrice: 1 }] }),
    });
    return { status: response.status, payload: (await response.json()) as { message?: string } };
  }, { id: invoiceId });
  expect(lockedPatch.status).toBe(409);
  expect(lockedPatch.payload.message).toContain("rectificativa");

  // 5) Rectificativa parcial (devolución de 1 hora de consultoría): −(100 € + 21 %) = −121 €.
  await page.goto(editHref!);
  await expect(page.getByTestId("invoice-edit-locked")).toContainText("ya está emitida");
  await expect(page.getByTestId("invoice-edit-form")).toHaveCount(0);
  await page.getByTestId("invoice-edit-create-credit-note").click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}/rectify$`));
  await page.getByText("Abonar solo una parte", { exact: true }).click();
  await page.getByRole("button", { name: "Quitar línea 2" }).click();
  await page.locator("#credit-note-line-1-quantity").fill("1");
  await page.locator("#credit-note-issue-date").fill("2026-05-20");
  await page.getByTestId("credit-note-description").fill("Devolución de 1 hora de consultoría");
  await expect(page.getByTestId("credit-note-total")).toContainText("121,00");
  const creditNoteResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith(`/api/invoices/${invoiceId}/credit-notes`) && response.request().method() === "POST",
  );
  await page.getByTestId("credit-note-submit").click();
  await page.getByTestId("invoice-issue-confirm").click();
  const creditNoteResponse = await creditNoteResponsePromise;
  expect(creditNoteResponse.status()).toBe(201);
  const creditNote = (await creditNoteResponse.json()) as { id: string; number: string; totalAmount: number };
  expect(creditNote.totalAmount).toBe(-121);
  await expect(page).toHaveURL(new RegExp(`/invoices/${creditNote.id}$`));
  await expect(page.getByTestId("credit-note-reference")).toContainText(issuedInvoice.number);

  // 6) El saldo pendiente de la original baja a 253 € (374 − 121) y se cobra entero.
  await postJson(page, "/api/invoice-payments", {
    invoiceId,
    amountApplied: 253,
    postedAt: "2026-05-10T00:00:00.000Z",
    paymentMethodId: linkedPaymentMethod!.id,
  });
  const settled = await (await page.request.get(`/api/invoices/${invoiceId}`)).json();
  expect(settled.paymentStatus).toBe("PAID");
  await page.goto(editHref!);
  await expect(page.getByTestId("invoice-edit-locked")).toContainText("Esta factura tiene cobros registrados");
  await expect(page.getByTestId("invoice-edit-form")).toHaveCount(0);
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
  await page.getByRole("button", { name: "Emitir factura" }).click();
  await page.getByTestId("invoice-issue-confirm").click();
  const invoiceResponse = await invoiceResponsePromise;
  expect(invoiceResponse.ok()).toBe(true);
  const createdInvoice = (await invoiceResponse.json()) as { number: string; lifecycle: string };
  expect(createdInvoice.lifecycle).toBe("ISSUED");
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole("heading", { name: createdInvoice.number })).toBeVisible();

  await page.goto("/invoices");
  const invoiceRow = page.locator("tr", { hasText: createdInvoice.number });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow.getByText(customerName)).toBeVisible();
});
