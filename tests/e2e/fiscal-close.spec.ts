import { expect, test, type Page } from "@playwright/test";

import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

test("una declaración presentada bloquea facturas dentro del periodo fiscal", async ({ page }) => {
  const runId = Date.now();

  await registerAndSignIn(page, "Fiscal Close E2E");
  await completeOnboarding(page, "Empresa cierre fiscal E2E S.L.");

  const customerResponse = await postJson(page, "/api/customers", {
    body: {
      name: `Cliente cierre fiscal ${runId}`,
      taxId: "B12345674",
      address: "Calle Cierre 1",
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      countryCode: "ES",
      email: `cliente-cierre-${runId}@example.test`,
    },
  });
  expect(customerResponse.ok).toBe(true);
  const customerId = customerResponse.payload?.id;
  expect(typeof customerId).toBe("string");

  // "Presentado" ya no se elige al crear: se crea el borrador y se marca con fecha y justificante.
  const filedOnCreate = await postJson(page, "/api/fiscal-reports", {
    body: { code: "303", period: "2026-Q2", status: "FILED" },
  });
  expect(filedOnCreate.status).toBe(400);

  const fiscalResponse = await postJson(page, "/api/fiscal-reports", {
    body: {
      code: "303",
      period: "2026-Q2",
      status: "DRAFT",
    },
  });
  expect(fiscalResponse.ok).toBe(true);
  const reportId = fiscalResponse.payload?.id;
  expect(typeof reportId).toBe("string");

  const filedResponse = await postJson(page, `/api/fiscal-reports/${reportId}/file`, {
    body: { filedAt: "2026-07-15", receiptNumber: "3030123456789" },
  });
  expect(filedResponse.ok).toBe(true);

  const lockedInvoiceResponse = await postJson(page, "/api/invoices", {
    body: {
      customerId,
      number: `FAC-BLOQ-${runId}`,
      issueDate: "2026-05-09",
      dueDate: "2026-06-09",
      totalAmount: 121,
      lines: [
        {
          description: "Consultoría",
          quantity: 1,
          unitPrice: 100,
          taxRate: 21,
        },
      ],
    },
  });
  // Periodo presentado: conflicto con el estado actual (409), con mensaje accionable.
  expect(lockedInvoiceResponse.status).toBe(409);
  expect(lockedInvoiceResponse.payload?.message ?? "").toContain("periodo fiscal 2026-Q2");

  const openInvoiceResponse = await postJson(page, "/api/invoices", {
    body: {
      customerId,
      number: `FAC-OPEN-${runId}`,
      issueDate: "2026-07-01",
      dueDate: "2026-08-01",
      totalAmount: 121,
      lines: [
        {
          description: "Consultoría",
          quantity: 1,
          unitPrice: 100,
          taxRate: 21,
        },
      ],
    },
  });
  expect(openInvoiceResponse.ok).toBe(true);
  // The setup wizard applies the default Spanish invoice prefix ("FA").
  expect(openInvoiceResponse.payload?.number).toMatch(/^FA\d{6}$/);
});

async function postJson(page: Page, path: string, options: { body: Record<string, unknown> }): Promise<ApiResponse>;
async function postJson(
  page: Page,
  path: string,
  options: { body: Record<string, unknown> },
): Promise<ApiResponse> {
  return page.evaluate(
    async ({ path, body }) => {
      const csrfToken = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("csrf-token="))
        ?.split("=")[1];

      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        payload: text ? JSON.parse(text) : null,
      };
    },
    { path, body: options.body },
  );
}

type ApiResponse = {
  ok: boolean;
  status: number;
  payload: {
    id?: string;
    message?: string;
    number?: string;
  } | null;
};
