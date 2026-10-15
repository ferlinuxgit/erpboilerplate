import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

const MINIMAL_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

test("exporta las facturas recibidas para el asesor en Excel y en ZIP con sus PDF", async ({ page }) => {
  test.setTimeout(120_000);
  const runId = Date.now();
  await registerAndSignIn(page, "Expense Export E2E");
  await completeOnboarding(page, "Empresa exportación E2E S.L.");

  // Justificante subido como en el formulario de nueva factura.
  const attachment = await page.evaluate(async (pdf) => {
    const csrfToken = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1];
    const formData = new FormData();
    formData.set("file", new File([pdf], "factura proveedor.pdf", { type: "application/pdf" }));
    const response = await fetch("/api/expenses/attachments", {
      method: "POST",
      headers: csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {},
      body: formData,
    });
    return { ok: response.ok, payload: (await response.json()) as { id: string } };
  }, MINIMAL_PDF);
  expect(attachment.ok).toBe(true);

  const today = new Date();
  const issueDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12)).toISOString();
  const created = await postJson<{ id: string; number: string }>(page, "/api/expenses", {
    supplierName: `Proveedor exportación ${runId}`,
    supplierTaxId: "B12345674",
    supplierDocumentNumber: `PX-${runId}`,
    issueDate,
    ocrJobId: attachment.payload.id,
    lines: [{ description: "Material de oficina", quantity: 1, unitPrice: 100, taxRate: 21 }],
  });

  await page.goto("/expenses");
  await page.getByTestId("expense-export-open").click();
  const day = issueDate.slice(0, 10);
  await page.getByTestId("expense-export-from").fill(day);
  await page.getByTestId("expense-export-to").fill(day);
  await expect(page.getByTestId("expense-export-documents")).toBeChecked();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("expense-export-submit").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^facturas-recibidas-.*\.zip$/);

  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const names = Object.keys(files);
  const pdfName = names.find((name) => name.startsWith("facturas/"));
  expect(pdfName).toContain(created.number.replace(/[^A-Za-z0-9]+/g, "-"));
  expect(new TextDecoder().decode(files[pdfName!]).startsWith("%PDF-")).toBe(true);

  const xlsxName = names.find((name) => name.endsWith(".xlsx"))!;
  const workbook = new ExcelJS.Workbook();
  const xlsx = files[xlsxName];
  await workbook.xlsx.load(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer);
  const sheet = workbook.getWorksheet("Facturas")!;
  const header = (sheet.getRow(1).values as unknown[]).slice(1);
  const row = sheet.getRow(2);
  expect(row.getCell(header.indexOf("Nº registro") + 1).value).toBe(created.number);
  expect(row.getCell(header.indexOf("Nº factura proveedor") + 1).value).toBe(`PX-${runId}`);
  expect(row.getCell(header.indexOf("Total factura") + 1).value).toBe(121);
  expect((row.getCell(header.indexOf("Documento") + 1).value as { hyperlink: string }).hyperlink).toBe(pdfName);

  // Solo Excel.
  const excelOnly = await page.request.get(`/api/expenses/export?from=${day}&to=${day}`);
  expect(excelOnly.ok()).toBe(true);
  expect(excelOnly.headers()["content-type"]).toContain("spreadsheetml");
});
