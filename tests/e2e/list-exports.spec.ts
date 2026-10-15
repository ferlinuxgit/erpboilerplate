import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

async function downloadExcel(page: Page, listTestId: string) {
  await page.getByTestId(`${listTestId}-export`).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Descargar Excel (.xlsx)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const bytes = await readFile((await download.path())!);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  const rows = Array.from({ length: sheet.rowCount - 1 }, (_, index) => {
    const row = sheet.getRow(index + 2);
    return Object.fromEntries(header.map((name, column) => [name, row.getCell(column + 1).value]));
  });
  return { header, rows };
}

test("exporta a Excel las facturas emitidas y los gastos filtrados con base, IVA, IRPF y total", async ({ page }) => {
  test.setTimeout(120_000);
  const runId = Date.now();
  await registerAndSignIn(page, "List Exports E2E");
  await completeOnboarding(page, "Empresa exportaciones E2E S.L.");
  const today = new Date().toISOString().slice(0, 10);
  const customerName = `Cliente export ${runId}`;

  // Factura emitida: 100 € + IVA 21 % − IRPF 15 % = 106 €.
  const issued = await postJson<{ number: string }>(page, "/api/invoices", {
    newCustomer: {
      name: customerName,
      taxId: "B12345674",
      address: "Calle Mayor 1",
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      countryCode: "ES",
    },
    issueDate: today,
    lines: [{ description: "Asesoría", quantity: 1, unitPrice: 100, taxRate: 21, retentionRate: 15 }],
  });

  await page.goto(`/invoices?q=${encodeURIComponent(customerName)}`);
  await expect(page.getByText(issued.number).first()).toBeVisible();
  // IRPF desmarcado: no sale en el Excel; el resto de importes sí.
  await page.getByTestId("invoices-list-export").click();
  await page.getByRole("menuitemcheckbox", { name: "IRPF" }).click();
  await page.keyboard.press("Escape");
  const sales = await downloadExcel(page, "invoices-list");
  expect(sales.header).toEqual(expect.arrayContaining(["Número", "Cliente", "Base", "IVA", "Total"]));
  expect(sales.header).not.toContain("IRPF");
  expect(sales.rows).toHaveLength(1);
  expect(sales.rows[0]).toMatchObject({ Número: issued.number, Cliente: customerName, Base: 100, IVA: 21, Total: 106 });

  // Gasto: 200 € + IVA 21 % − IRPF 15 % = 212 €.
  const supplierNumber = `GX-${runId}`;
  const expense = await postJson<{ number: string }>(page, "/api/expenses", {
    supplierName: `Proveedor export ${runId}`,
    supplierTaxId: "B12345674",
    supplierDocumentNumber: supplierNumber,
    issueDate: new Date(`${today}T12:00:00.000Z`).toISOString(),
    lines: [{ description: "Servicios profesionales", quantity: 1, unitPrice: 200, taxRate: 21, retentionRate: 15 }],
  });

  await page.goto(`/expenses?q=${encodeURIComponent(supplierNumber)}`);
  await expect(page.getByText(supplierNumber).first()).toBeVisible();
  const purchases = await downloadExcel(page, "expenses-list");
  expect(purchases.header).toEqual(expect.arrayContaining(["Proveedor", "Nº registro", "Nº factura proveedor", "Base", "IVA", "IRPF", "Total"]));
  expect(purchases.rows).toHaveLength(1);
  expect(purchases.rows[0]).toMatchObject({ "Nº registro": expense.number, "Nº factura proveedor": supplierNumber, Base: 200, IVA: 42, IRPF: 30, Total: 212 });
});
