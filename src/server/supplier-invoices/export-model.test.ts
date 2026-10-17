import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildExpenseExport,
  buildExpenseExportWorkbook,
  deductibleTaxAmount,
  expenseDocumentFileName,
  type ExpenseExportData,
  type ExpenseExportInvoice,
} from "@/server/supplier-invoices/export-model";

function invoice(patch: Partial<ExpenseExportInvoice> = {}): ExpenseExportInvoice {
  return {
    id: "inv-1",
    number: "FP-2026/0001",
    issueDate: new Date("2026-02-10T12:00:00.000Z"),
    accountingDate: new Date("2026-02-10T12:00:00.000Z"),
    dueDate: new Date("2026-03-12T12:00:00.000Z"),
    supplierDocumentNumber: "A-118",
    supplierName: "Suministros Levante, S.L.",
    supplierTaxId: "B12345674",
    supplierCountryCode: "ES",
    vatTreatment: "DOMESTIC",
    currencyCode: "EUR",
    subtotalAmount: 150,
    taxAmount: 26,
    retentionAmount: 0,
    totalAmount: 176,
    paidAmount: 100,
    paymentStatus: "PARTIAL",
    purchaseOrderNumber: null,
    notes: null,
    prorrataPct: 100,
    lines: [
      { accountCode: "62800000", accountName: "Suministros", base: 100, taxRate: 21, taxAmount: 21, taxDeductiblePct: 100, retentionRate: 0, retentionAmount: 0 },
      { accountCode: "62900000", accountName: "Otros servicios", base: 50, taxRate: 10, taxAmount: 5, taxDeductiblePct: 50, retentionRate: 0, retentionAmount: 0 },
    ],
    documents: [{ fileName: "factura levante.pdf", contentType: "application/pdf", load: async () => new Uint8Array([37, 80, 68, 70]) }],
    ...patch,
  };
}

function data(invoices: ExpenseExportInvoice[]): ExpenseExportData {
  return { companyName: "Mi Empresa", companyTaxId: "B87654315", periodLabel: "1T 2026", generatedAt: new Date("2026-04-02T10:00:00.000Z"), invoices };
}

async function readWorkbook(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return workbook;
}

describe("expense export", () => {
  it("names documents by registry number, supplier and supplier invoice number", () => {
    expect(expenseDocumentFileName(invoice(), invoice().documents[0])).toBe("facturas/FP-2026-0001_Suministros-Levante-S-L_A-118.pdf");
    expect(expenseDocumentFileName(invoice({ supplierDocumentNumber: null }), { fileName: "ticket", contentType: "image/jpeg" }, 1)).toBe("facturas/FP-2026-0001_Suministros-Levante-S-L-2.jpg");
  });

  it("computes the deductible VAT per line with the deductible % and the prorrata", () => {
    expect(deductibleTaxAmount(invoice())).toBe(23.5);
    expect(deductibleTaxAmount(invoice({ prorrataPct: 80 }))).toBe(18.8);
  });

  it("separates VAT charged by the supplier from self-assessed VAT (intra-EU, reverse charge)", async () => {
    const anthropic = invoice({
      id: "inv-eu", number: "FP-2026/0003", supplierName: "Anthropic Ireland, Limited", supplierTaxId: "IE4276970QH", supplierCountryCode: "IE",
      vatTreatment: "INTRA_EU", subtotalAmount: 93.33, taxAmount: 19.6, totalAmount: 93.33, paidAmount: 93.33, paymentStatus: "PAID",
      lines: [{ accountCode: "62900000", accountName: "Otros servicios", base: 93.33, taxRate: 21, taxAmount: 19.6, taxDeductiblePct: 100, retentionRate: 0, retentionAmount: 0 }],
    });
    const workbook = await readWorkbook(await buildExpenseExportWorkbook(data([invoice(), anthropic])));
    const sheet = workbook.getWorksheet("Facturas")!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    const cell = (row: number, name: string) => sheet.getRow(row).getCell(header.indexOf(name) + 1).value;
    // Nacional: el IVA lo cobra el proveedor.
    expect([cell(2, "Cuota IVA"), cell(2, "IVA autorrepercutido")]).toEqual([26, null]);
    // Intracomunitaria: no se cobra (base + cuota = total) y se declara como autorrepercutido y deducible.
    expect(cell(3, "Tipo de operación")).toBe("Adquisición intracomunitaria");
    expect([cell(3, "Base imponible"), cell(3, "Cuota IVA"), cell(3, "IVA autorrepercutido"), cell(3, "IVA deducible"), cell(3, "Total factura")]).toEqual([93.33, 0, 19.6, 19.6, 93.33]);
    expect([cell(4, "Cuota IVA"), cell(4, "IVA autorrepercutido"), cell(4, "IVA deducible")]).toEqual([26, 19.6, 43.1]);

    const breakdown = workbook.getWorksheet("Desglose IVA")!;
    const breakdownHeader = (breakdown.getRow(1).values as unknown[]).slice(1);
    const euRow = breakdown.getRow(breakdown.rowCount);
    expect(euRow.getCell(breakdownHeader.indexOf("Cuota IVA") + 1).value).toBe(0);
    expect(euRow.getCell(breakdownHeader.indexOf("IVA autorrepercutido") + 1).value).toBe(19.6);
    expect(euRow.getCell(breakdownHeader.indexOf("IVA deducible") + 1).value).toBe(19.6);
  });

  it("writes one row per invoice with totals and a VAT breakdown per account and rate", async () => {
    const workbook = await readWorkbook(await buildExpenseExportWorkbook(data([invoice(), invoice({ id: "inv-2", number: "FP-2026/0002", paidAmount: 176, paymentStatus: "PAID" })])));
    const sheet = workbook.getWorksheet("Facturas")!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expect.arrayContaining(["Nº registro", "Fecha factura", "Nº factura proveedor", "Proveedor", "NIF", "Base imponible", "Cuota IVA", "IVA deducible", "Retención IRPF", "Total factura", "Documento"]));
    const column = (name: string) => header.indexOf(name) + 1;
    expect(sheet.getRow(2).getCell(column("Nº registro")).value).toBe("FP-2026/0001");
    expect(sheet.getRow(2).getCell(column("Tipos de IVA (%)")).value).toBe("21 / 10");
    expect(sheet.getRow(2).getCell(column("Pendiente")).value).toBe(76);
    const total = sheet.getRow(4);
    expect(total.getCell(column("Total factura")).value).toBe(352);
    expect(total.getCell(column("IVA deducible")).value).toBe(47);

    const breakdown = workbook.getWorksheet("Desglose IVA")!;
    expect(breakdown.rowCount).toBe(5);
  });

  it("returns just the Excel when documents are not requested", async () => {
    const result = await buildExpenseExport(data([invoice()]), { includeDocuments: false });
    expect(result.fileName).toBe("facturas-recibidas-mi-empresa-1t-2026.xlsx");
    expect(result.contentType).toContain("spreadsheetml");
  });

  it("zips the Excel with the documents, links them and lists invoices without document", async () => {
    const result = await buildExpenseExport(data([
      invoice(),
      invoice({ id: "inv-2", number: "FP-2026/0002", documents: [] }),
      invoice({ id: "inv-3", number: "FP-2026/0003", documents: [{ fileName: "roto.pdf", contentType: "application/pdf", load: async () => { throw new Error("missing"); } }] }),
    ]), { includeDocuments: true });

    expect(result.fileName).toBe("facturas-recibidas-mi-empresa-1t-2026.zip");
    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual(["LEEME.txt", "facturas-recibidas-mi-empresa-1t-2026.xlsx", "facturas/FP-2026-0001_Suministros-Levante-S-L_A-118.pdf"]);
    expect(result.missing).toHaveLength(2);
    expect(strFromU8(files["LEEME.txt"])).toContain("FP-2026/0002");

    const workbook = await readWorkbook(files["facturas-recibidas-mi-empresa-1t-2026.xlsx"]);
    const sheet = workbook.getWorksheet("Facturas")!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    const cell = sheet.getRow(2).getCell(header.indexOf("Documento") + 1).value as { hyperlink: string };
    expect(cell.hyperlink).toBe("facturas/FP-2026-0001_Suministros-Levante-S-L_A-118.pdf");
    expect(sheet.getRow(3).getCell(header.indexOf("Documento") + 1).value).toBe("Sin documento");
  });
});
