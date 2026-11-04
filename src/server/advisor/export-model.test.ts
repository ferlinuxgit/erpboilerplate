import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { advisorFileBaseName, buildAdvisorWorkbook, buildSalesZip, fileSlug, salesColumns, salesPdfPath, type SalesExportInvoice } from "@/server/advisor/export-model";

const meta = { title: "Facturas emitidas", companyName: "Acme Ñu, S.L.", companyTaxId: "B12345678", periodLabel: "3.º trimestre 2026", generatedAt: new Date("2026-10-05T08:00:00.000Z") };

const invoice = (overrides: Partial<SalesExportInvoice> = {}): SalesExportInvoice => ({
  id: "inv-1",
  number: "F2026/0001",
  invoiceType: "INVOICE",
  rectifiedNumber: null,
  issueDate: new Date("2026-07-02T00:00:00.000Z"),
  dueDate: null,
  lifecycle: "ISSUED",
  customerName: "Cliente Año, S.A.",
  customerTaxId: "A87654321",
  customerCountryCode: "ES",
  vatTreatment: null,
  subtotal: 100,
  taxAmount: 21,
  retentionAmount: 15,
  totalAmount: 106,
  paidAmount: 0,
  outstandingAmount: 106,
  paymentStatus: "PENDING",
  ...overrides,
});

async function readSheet(bytes: Uint8Array, name: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.getWorksheet(name)!;
  const rows: unknown[][] = [];
  sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe("ficheros del portal del asesor", () => {
  it("nombra los ficheros sin acentos ni símbolos", () => {
    expect(fileSlug("Acme Ñu, S.L.")).toBe("Acme-Nu-S-L");
    expect(advisorFileBaseName("facturas-emitidas", meta.companyName, meta.periodLabel)).toBe("facturas-emitidas-acme-nu-s-l-3-trimestre-2026");
    expect(salesPdfPath(invoice())).toBe("facturas/F2026-0001_Cliente-Ano-S-A.pdf");
  });

  it("genera el Excel con cabecera, filas, totales y hoja de información", async () => {
    const bytes = await buildAdvisorWorkbook(meta, [{ name: "Facturas emitidas", columns: salesColumns(), rows: [invoice(), invoice({ id: "inv-2", number: "R2026/0001", invoiceType: "CREDIT_NOTE", rectifiedNumber: "F2026/0001", subtotal: -50, taxAmount: -10.5, retentionAmount: 0, totalAmount: -60.5 })] }]);
    const rows = await readSheet(bytes, "Facturas emitidas");
    expect(rows[0]).toContain("Base imponible");
    expect(rows[1]).toEqual(expect.arrayContaining(["F2026/0001", "Factura", "Cliente Año, S.A.", "A87654321", 100, 21, 15, 106]));
    expect(rows[2]).toEqual(expect.arrayContaining(["R2026/0001", "Rectificativa", "F2026/0001", -50]));
    // Fila de totales: base 50, IVA 10,5, total 45,5.
    expect(rows[3]).toEqual(expect.arrayContaining(["Total", 50, 10.5, 45.5]));
    const about = await readSheet(bytes, "Información");
    expect(about).toEqual(expect.arrayContaining([["NIF", "B12345678"], ["Periodo", "3.º trimestre 2026"]]));
  });

  it("empaqueta los PDF, enlaza el listado y explica los que faltan", async () => {
    const result = await buildSalesZip({
      meta,
      baseName: "facturas-emitidas-acme",
      invoices: [invoice(), invoice({ id: "inv-2", number: "F2026/0002" }), invoice({ id: "inv-3", number: "F2026/0003" })],
      loadPdf: async (row) => {
        if (row.id === "inv-2") return null;
        if (row.id === "inv-3") throw new Error("storage down");
        return new Uint8Array([37, 80, 68, 70]);
      },
    });
    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual(["LEEME.txt", "facturas-emitidas-acme.xlsx", "facturas/F2026-0001_Cliente-Ano-S-A.pdf"]);
    expect(result.missing).toHaveLength(2);
    expect(strFromU8(files["LEEME.txt"])).toContain("F2026/0002 · Cliente Año, S.A.: no se pudo generar el PDF.");
    const workbook = new ExcelJS.Workbook();
    const xlsx = files["facturas-emitidas-acme.xlsx"];
    await workbook.xlsx.load(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength) as ArrayBuffer);
    const cell = workbook.getWorksheet("Facturas emitidas")!.getCell("A2").value as { text: string; hyperlink: string };
    expect(cell).toEqual({ text: "F2026/0001", hyperlink: "facturas/F2026-0001_Cliente-Ano-S-A.pdf" });
  });
});
