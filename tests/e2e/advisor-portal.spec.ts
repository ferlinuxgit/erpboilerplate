import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";

import { postJson } from "./helpers/api-client";
import { completeOnboarding, registerAndSignIn } from "./helpers/authenticated-session";

const MINIMAL_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

async function uploadAttachment(page: Page) {
  const attachment = await page.evaluate(async (pdf) => {
    const csrfToken = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf-token="))?.split("=")[1];
    const formData = new FormData();
    formData.set("file", new File([pdf], "factura luz.pdf", { type: "application/pdf" }));
    const response = await fetch("/api/expenses/attachments", { method: "POST", headers: csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {}, body: formData });
    return { ok: response.ok, payload: (await response.json()) as { id: string } };
  }, MINIMAL_PDF);
  expect(attachment.ok).toBe(true);
  return attachment.payload.id;
}

async function downloaded(page: Page, trigger: () => Promise<void>) {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile((await download.path())!)) };
}

test("el asesor entra con su contraseña, descarga la documentación y pierde el acceso al revocarlo", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const runId = Date.now();
  await registerAndSignIn(page, "Advisor Portal E2E");
  await completeOnboarding(page, "Empresa asesor E2E S.L.");

  // Datos del periodo: una factura emitida, un borrador (no debe verlo el asesor) y un gasto con documento.
  const customer = await postJson<{ id: string }>(page, "/api/customers", { name: `Cliente asesor ${runId}`, taxId: "B12345674", address: "Calle Mayor 1", postalCode: "28013", city: "Madrid", province: "Madrid", countryCode: "ES" });
  const today = new Date();
  const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
  const issued = await postJson<{ id: string; number: string }>(page, "/api/invoices", { customerId: customer.id, issueDate: day, lines: [{ description: "Asesoría", quantity: 1, unitPrice: 100, taxRate: 21 }] });
  const draft = await postJson<{ id: string; number: string }>(page, "/api/invoices", { customerId: customer.id, issueDate: day, mode: "draft", lines: [{ description: "Borrador", quantity: 1, unitPrice: 50, taxRate: 21 }] });
  const ocrJobId = await uploadAttachment(page);
  const expense = await postJson<{ id: string; number: string }>(page, "/api/expenses", {
    supplierName: `Proveedor asesor ${runId}`,
    supplierTaxId: "B12345674",
    supplierDocumentNumber: `LUZ-${runId}`,
    issueDate: new Date(`${day}T12:00:00.000Z`).toISOString(),
    ocrJobId,
    lines: [{ description: "Electricidad", quantity: 1, unitPrice: 80, taxRate: 21 }],
  });

  // El propietario crea el acceso desde Configuración y obtiene la contraseña.
  const advisorEmail = `gestor-${runId}@despacho.test`;
  await page.goto("/settings/asesor");
  await page.getByTestId("advisor-access-create").click();
  await page.getByLabel("Nombre del asesor").fill("Laura Gestora");
  await page.getByLabel("Gestoría o despacho (opcional)").fill("Despacho Contable");
  await page.getByLabel("Email de acceso").fill(advisorEmail);
  await page.getByRole("button", { name: "Crear acceso" }).click();
  const password = (await page.getByTestId("advisor-credentials-password").textContent())?.trim() ?? "";
  expect(password.length).toBeGreaterThanOrEqual(10);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("advisor-access-list")).toContainText(advisorEmail);

  // El asesor, en su propio navegador, entra en el portal.
  const advisorContext = await browser.newContext({ acceptDownloads: true });
  const advisor = await advisorContext.newPage();
  await advisor.goto("/asesor");
  await expect(advisor).toHaveURL(/\/asesor\/acceso/);
  await advisor.getByLabel("Email").fill(advisorEmail);
  await advisor.getByLabel("Contraseña", { exact: true }).fill("contraseña-incorrecta");
  await advisor.getByRole("button", { name: "Entrar" }).click();
  await expect(advisor.getByText("Email o contraseña incorrectos")).toBeVisible();
  await advisor.getByLabel("Contraseña", { exact: true }).fill(password);
  await advisor.getByRole("button", { name: "Entrar" }).click();
  await expect(advisor.getByTestId("advisor-company-name")).toContainText("Empresa asesor E2E");

  // Ejercicio completo del año en curso.
  await advisor.getByLabel("Ejercicio", { exact: true }).selectOption({ label: String(today.getFullYear()) });
  await advisor.getByLabel("Periodo", { exact: true }).selectOption("year");
  await advisor.getByRole("button", { name: "Ver periodo" }).click();
  await expect(advisor.getByTestId("advisor-period-label")).toContainText(`Ejercicio ${today.getFullYear()}`);
  const query = new URL(advisor.url()).search;

  // Ventas: la emitida sí, el borrador no; PDF suelto y ZIP de la selección.
  await advisor.getByRole("link", { name: "Ventas" }).click();
  const salesTable = advisor.getByTestId("advisor-sales-table");
  await expect(salesTable).toContainText(issued.number);
  await expect(salesTable).not.toContainText(draft.number);
  const pdf = await advisor.request.get(`/api/advisor/sales/${issued.id}/pdf`);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await advisor.request.get(`/api/advisor/sales/${draft.id}/pdf`)).status()).toBe(404);

  await salesTable.getByRole("checkbox", { name: `Seleccionar ${issued.number}` }).check();
  const selection = await downloaded(advisor, () => advisor.getByTestId("advisor-sales-table-selection-zip").click());
  expect(selection.name).toMatch(/^facturas-emitidas-.*\.zip$/);
  const selectionFiles = Object.keys(unzipSync(selection.bytes));
  expect(selectionFiles.filter((name) => name.startsWith("facturas/") && name.endsWith(".pdf"))).toHaveLength(1);
  expect(selectionFiles.some((name) => name.endsWith(".xlsx"))).toBe(true);

  const salesExcel = await downloaded(advisor, () => advisor.getByTestId("advisor-sales-xlsx").click());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(salesExcel.bytes.buffer.slice(salesExcel.bytes.byteOffset, salesExcel.bytes.byteOffset + salesExcel.bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.getWorksheet("Facturas emitidas")!;
  const header = (sheet.getRow(1).values as unknown[]).slice(1);
  expect(sheet.getRow(2).getCell(header.indexOf("Número") + 1).value).toBe(issued.number);
  expect(sheet.getRow(2).getCell(header.indexOf("Base imponible") + 1).value).toBe(100);
  expect(sheet.getRow(2).getCell(header.indexOf("Cuota IVA") + 1).value).toBe(21);

  // Gastos: documento original suelto y ZIP de todo el periodo.
  await advisor.getByRole("link", { name: "Gastos" }).click();
  await expect(advisor.getByTestId("advisor-expenses-table")).toContainText(expense.number);
  const document = await advisor.request.get(`/api/advisor/expenses/${expense.id}/document`);
  expect(document.ok()).toBe(true);
  expect((await document.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const expensesZip = await downloaded(advisor, () => advisor.getByTestId("advisor-expenses-zip").click());
  expect(Object.keys(unzipSync(expensesZip.bytes)).some((name) => name.startsWith("facturas/"))).toBe(true);

  // Libros, IVA y listados.
  await advisor.getByRole("link", { name: "Contabilidad" }).click();
  const journal = await downloaded(advisor, () => advisor.getByTestId("advisor-download-diario").click());
  expect(journal.name).toMatch(/^libro-diario-.*\.xlsx$/);
  await advisor.getByRole("link", { name: "Impuestos" }).click();
  const vatIssued = await downloaded(advisor, () => advisor.getByTestId("advisor-download-iva-expedidas").click());
  expect(vatIssued.name).toMatch(/^libro-iva-expedidas-.*\.xlsx$/);
  await advisor.getByRole("link", { name: "Otros datos" }).click();
  const customers = await downloaded(advisor, () => advisor.getByTestId("advisor-download-clientes").click());
  expect(customers.name).toMatch(/^clientes-.*\.xlsx$/);

  // Todo el periodo en un ZIP, ordenado por carpetas.
  const fullPackage = await advisor.request.get(`/api/advisor/package${query}`, { timeout: 120_000 });
  expect(fullPackage.ok()).toBe(true);
  const packageFiles = Object.keys(unzipSync(new Uint8Array(await fullPackage.body())));
  expect(packageFiles).toEqual(expect.arrayContaining(["LEEME.txt"]));
  for (const folder of ["01-ventas/", "02-gastos/", "03-contabilidad-e-impuestos/", "04-otros/"]) {
    expect(packageFiles.some((name) => name.startsWith(folder)), folder).toBe(true);
  }

  // La sesión del asesor no abre el ERP.
  expect((await advisor.request.get("/api/invoices")).status()).toBe(401);
  await advisor.goto("/invoices");
  await expect(advisor).toHaveURL(/\/auth\/login/);

  // El propietario ve la actividad y revoca: el asesor queda fuera al momento.
  await page.reload();
  await expect(page.getByTestId("advisor-activity")).toContainText("El asesor descargó documentación");
  await page.getByRole("button", { name: "Revocar" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Revocar" }).click();
  await expect(page.getByTestId("advisor-access-list")).toContainText("Revocado");
  expect((await advisor.request.get(`/api/advisor/sales/${issued.id}/pdf`)).status()).toBe(401);
  await advisor.goto("/asesor");
  await expect(advisor).toHaveURL(/\/asesor\/acceso/);

  await advisorContext.close();
});
