import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Libros en formato AEAT y ficheros de presentación contra Postgres real (PGlite en memoria) con el
 * esquema completo de Drizzle: comprueba que las consultas funcionan y que los datos llegan a su
 * columna o a su posición. No se llama a ningún servicio externo.
 */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});

import * as schema from "@/db/schema";
import { accountChart, capitalIncomePayment, company, companySettings, customer, fiscalReport, fixedAsset, invoice, invoiceLine, invoiceLineTax, partner, rentalProperty, supplierInvoice, supplierInvoiceLine, tenant, user } from "@/db/schema";
import { buildLsiBooks } from "@/server/fiscal-files/lsi-service";
import { generatePresentationFile } from "@/server/fiscal-files/presentation-service";
import { fiscalSummaryToCsv } from "@/server/fiscal/export";
import { calculateSpanishFiscalSummary } from "@/server/fiscal/spain";
import { renderFiscalReportPdf } from "@/server/pdf/render";

const COMPANY = "company-1";
const noon = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const at = (text: string, pos: number, len: number) => text.slice(pos - 1, pos - 1 + len);

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  const db = state.db;

  await db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Taller Peñón", legalName: "Peñón García, Ana", vatNumber: "12345678Z", postalCode: "28001", phone: "912345678" });
  await db.insert(companySettings).values({ companyId: COMPANY, taxpayerType: "individual" });
  await db.insert(accountChart).values([
    { id: "acc-623", companyId: COMPANY, code: "623", name: "Servicios de profesionales", type: "EXPENSE" },
    { id: "acc-621", companyId: COMPANY, code: "621", name: "Arrendamientos", type: "EXPENSE" },
    { id: "acc-217", companyId: COMPANY, code: "217", name: "Equipos informáticos", type: "ASSET" },
  ]);
  await db.insert(partner).values([
    { id: "p-client", companyId: COMPANY, number: "C1", name: "Cliente Uno, S.A.", taxId: "A58818501", postalCode: "08001" },
    { id: "p-lawyer", companyId: COMPANY, number: "P1", type: "SUPPLIER", name: "Abogada Núñez", taxId: "00000000T", postalCode: "28013" },
    { id: "p-landlord", companyId: COMPANY, number: "P2", type: "SUPPLIER", name: "Locales, S.L.", taxId: "B12345674", postalCode: "28013" },
  ]);
  await db.insert(customer).values({ id: "customer-1", companyId: COMPANY, partnerId: "p-client", name: "Cliente Uno" });

  // Factura emitida de febrero: 1.000 € al 21 % con retención del 15 % y 200 € al 10 %.
  await db.insert(invoice).values({ id: "inv-1", companyId: COMPANY, customerId: "customer-1", number: "F-2026/0001", issueDate: noon("2026-02-10"), issuedAt: noon("2026-02-10"), totalAmount: "1280.00", status: "SENT" });
  await db.insert(invoiceLine).values([
    { id: "il-1", invoiceId: "inv-1", description: "Servicio", quantity: "1", unitPrice: "1000.00", taxRate: "21", retentionRate: "15", lineTotal: "1060.00" },
    { id: "il-2", invoiceId: "inv-1", description: "Material", quantity: "2", unitPrice: "100.00", taxRate: "10", lineTotal: "220.00" },
  ]);
  await db.insert(invoiceLineTax).values([
    { invoiceLineId: "il-1", name: "IVA 21 %", rate: "21", kind: "VAT", operation: "ADD", baseAmount: "1000.00", amount: "210.00" },
    { invoiceLineId: "il-1", name: "IRPF 15 %", rate: "15", kind: "WITHHOLDING", operation: "SUBTRACT", baseAmount: "1000.00", amount: "150.00" },
    { invoiceLineId: "il-2", name: "IVA 10 %", rate: "10", kind: "VAT", operation: "ADD", baseAmount: "200.00", amount: "20.00" },
  ]);
  // Factura de julio: fuera de un libro pedido hasta el 2.º trimestre.
  await db.insert(invoice).values({ id: "inv-2", companyId: COMPANY, customerId: "customer-1", number: "F-2026/0002", issueDate: noon("2026-07-10"), issuedAt: noon("2026-07-10"), totalAmount: "121.00", status: "SENT" });
  await db.insert(invoiceLine).values({ id: "il-3", invoiceId: "inv-2", description: "Servicio", quantity: "1", unitPrice: "100.00", taxRate: "21", lineTotal: "121.00" });

  // Recibidas del 1T: abogada (retención 15 %), alquiler (retención 19 %) y un ordenador (bien de inversión).
  await db.insert(supplierInvoice).values([
    { id: "si-1", companyId: COMPANY, supplierPartnerId: "p-lawyer", number: "FR-0001", supplierDocumentNumber: "A/1", issueDate: noon("2026-01-20"), accountingDate: noon("2026-01-21"), totalAmount: "1060.00" },
    { id: "si-2", companyId: COMPANY, supplierPartnerId: "p-landlord", number: "FR-0002", supplierDocumentNumber: "L/7", issueDate: noon("2026-03-01"), accountingDate: noon("2026-03-02"), totalAmount: "510.00" },
    { id: "si-3", companyId: COMPANY, supplierPartnerId: "p-landlord", number: "FR-0003", supplierDocumentNumber: "L/9", issueDate: noon("2026-03-05"), accountingDate: noon("2026-03-05"), totalAmount: "1210.00" },
  ]);
  await db.insert(supplierInvoiceLine).values([
    { supplierInvoiceId: "si-1", expenseAccountId: "acc-623", description: "Asesoría", quantity: "1", unitPrice: "1000.00", taxRate: "21", retentionRate: "15", subtotalAmount: "1000.00", taxAmount: "210.00", retentionAmount: "150.00", lineTotal: "1060.00" },
    { supplierInvoiceId: "si-2", expenseAccountId: "acc-621", description: "Alquiler", quantity: "1", unitPrice: "500.00", taxRate: "21", retentionRate: "19", subtotalAmount: "500.00", taxAmount: "105.00", retentionAmount: "95.00", lineTotal: "510.00" },
    { supplierInvoiceId: "si-3", expenseAccountId: "acc-217", description: "Ordenador", quantity: "1", unitPrice: "1000.00", taxRate: "21", subtotalAmount: "1000.00", taxAmount: "210.00", isInvestmentGood: true, lineTotal: "1210.00" },
  ]);
  await db.insert(fixedAsset).values({ id: "fa-1", companyId: COMPANY, code: "BI-0001", description: "Ordenador portátil", assetAccountId: "acc-217", acquisitionDate: "2026-03-05", inServiceDate: "2026-03-05", acquisitionCost: "1000.00", annualPct: "25", supplierInvoiceId: "si-3" });

  // Inmueble del arrendador (180) y un dividendo de marzo con retención del 19 % (123 y 193).
  await db.insert(rentalProperty).values({ companyId: COMPANY, supplierPartnerId: "p-landlord", situation: "1", cadastralReference: "9872023VH5797S0001WX", address: "Calle Mayor 5", postalCode: "28013", city: "Madrid" });
  await db.insert(capitalIncomePayment).values({ companyId: COMPANY, recipientName: "Socia Uno", recipientTaxId: "87654321X", kind: "dividend", paymentDate: "2026-03-20", grossAmount: "1000.00", withholdingRate: "19", withholdingAmount: "190.00" });

  await db.insert(fiscalReport).values([
    { id: "r-123", companyId: COMPANY, code: "123", period: "2026-Q1" },
    { id: "r-190", companyId: COMPANY, code: "190", period: "2026" },
    { id: "r-180", companyId: COMPANY, code: "180", period: "2026" },
    { id: "r-193", companyId: COMPANY, code: "193", period: "2026" },
    { id: "r-111", companyId: COMPANY, code: "111", period: "2026-Q1" },
    { id: "r-115", companyId: COMPANY, code: "115", period: "2026-Q1" },
    { id: "r-303", companyId: COMPANY, code: "303", period: "2026-Q1" },
    { id: "r-390", companyId: COMPANY, code: "390", period: "2026" },
  ]);
}, 120_000);

describe("libros registro en formato AEAT (con base de datos)", () => {
  it("genera los tres libros unificados de un autónomo hasta el trimestre pedido", async () => {
    const result = await buildLsiBooks({ companyId: COMPANY, year: 2026, quarter: 2, activity: { code: "A", type: "05", iaeGroup: "731" } });
    expect(result.fileName).toBe("202612345678ZTPEÑON GARCIA ANA.xlsx");
    expect(result.isIndividual).toBe(true);
    // Expedidas: la factura de febrero (dos tipos); la de julio queda fuera.
    expect(result.counts).toEqual({ issued: 2, received: 3, assets: 1 });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.bytes.buffer as ArrayBuffer);
    const issued = workbook.getWorksheet("EXPEDIDAS_INGRESOS") as ExcelJS.Worksheet;
    const values = (sheet: ExcelJS.Worksheet, row: number, cells: string[]) => cells.map((cell) => sheet.getCell(`${cell}${row}`).value);
    expect(values(issued, 4, ["A", "B", "C", "D", "E", "F", "G", "H", "L", "P", "R", "S", "U", "V", "W", "X", "AE", "AF"]))
      .toEqual([2026, "1T", "A", "05", "731", "F1", "I01", 1000, "F-2026/0001", "A58818501", "01", "S1", 1210, 1000, 21, 210, 15, 150]);
    expect(values(issued, 5, ["H", "U", "V", "W", "X", "AE", "AF"])).toEqual([200, 220, 200, 10, 20, null, null]);

    const received = workbook.getWorksheet("RECIBIDAS_GASTOS") as ExcelJS.Worksheet;
    expect(values(received, 4, ["A", "B", "F", "G", "H", "K", "N", "R", "S", "T", "U", "V", "Z", "AA", "AB", "AC", "AD", "AK", "AL"]))
      .toEqual([2026, "1T", "F1", "G19", 1000, "A/1", "FR-0001", "00000000T", "Abogada Núñez", "01", "N", "N", 1210, 1000, 21, 210, 210, 15, 150]);
    expect(values(received, 5, ["G", "K", "AK", "AL"])).toEqual(["G12", "L/7", 19, 95]);
    // El ordenador: bien de inversión, sin concepto de gasto (se amortiza).
    expect(values(received, 6, ["G", "H", "K", "U"])).toEqual([null, null, "L/9", "S"]);

    const assets = workbook.getWorksheet("BIENES-INVERSIÓN") as ExcelJS.Worksheet;
    expect(values(assets, 4, ["A", "B", "F", "G", "H", "J", "K", "L", "M", "N", "O", "S", "U", "Y", "AA", "AB", "AC", "AD"]))
      .toEqual([2026, "4T", "23", "BI-0001", "Ordenador portátil", 1000, 1000, "01", 25, 0, 0, "L/9", "FR-0003", "B12345674", 1000, 21, 100, 210]);
  });

  it("valida el ejercicio", async () => {
    await expect(buildLsiBooks({ companyId: COMPANY, year: Number.NaN })).rejects.toThrow(/ejercicio/);
  });
});

describe("ficheros de presentación (con base de datos)", () => {
  const generate = (reportId: string, options?: Parameters<typeof generatePresentationFile>[0]["options"]) => generatePresentationFile({ companyId: COMPANY, tenantId: "tenant-1", actorUserId: "user-1", reportId, options });

  it("genera el 111 con los perceptores profesionales del periodo", async () => {
    const file = await generate("r-111");
    const page = file.text.slice(328);
    expect(file.fileName).toBe("111-2026-1T.txt");
    expect(file.source).toBe("live");
    expect(at(page, 14, 9)).toBe("12345678Z");
    expect(at(page, 23, 60).trim()).toBe("PEÑON GARCIA");
    expect(at(page, 83, 20).trim()).toBe("ANA");
    expect(at(page, 193, 8)).toBe("00000001");
    expect(at(page, 201, 17)).toBe("00000000000100000");
    expect(at(page, 218, 17)).toBe("00000000000015000");
  });

  it("genera el 115 con los arrendadores del periodo", async () => {
    const page = (await generate("r-115")).text.slice(328);
    expect(at(page, 109, 15)).toBe("000000000000001");
    expect(at(page, 124, 17)).toBe("00000000000050000");
    expect(at(page, 141, 17)).toBe("00000000000009500");
  });

  it("genera el 303 del trimestre con las casillas del cálculo", async () => {
    const file = await generate("r-303");
    const page1 = file.text.slice(328, 328 + 1581);
    const page3 = file.text.slice(328 + 1581, 328 + 1581 + 1017);
    expect(file.text.length).toBe(328 + 1581 + 1017 + 823 + 18);
    // Devengado: 200 € al 10 % y 1.000 € al 21 %. Deducible: 525 € de cuota.
    expect(at(page1, 287, 17)).toBe("00000000000020000");
    expect(at(page1, 309, 17)).toBe("00000000000002000");
    expect(at(page1, 326, 17)).toBe("00000000000100000");
    expect(at(page1, 348, 17)).toBe("00000000000021000");
    expect(at(page1, 696, 17)).toBe("00000000000023000");
    expect(at(page1, 1002, 17)).toBe("00000000000052500");
    expect(at(page1, 1019, 17)).toBe("N0000000000029500");
    expect(at(page1, 13, 1)).toBe("C");
    expect(at(page3, 408, 17)).toBe("N0000000000029500");
  });

  it("explica por qué no hay fichero del 390", async () => {
    await expect(generate("r-390")).rejects.toThrow(/390/);
    await expect(generate("no-existe")).rejects.toThrow(/no encontrado/);
  });

  it("genera el 123 del trimestre con el dividendo", async () => {
    const page = (await generate("r-123")).text.slice(328);
    expect(at(page, 109, 15)).toBe("000000000000001");
    expect(at(page, 154, 17)).toBe("00000000000100000");
    expect(at(page, 205, 17)).toBe("00000000000019000");
    expect(at(page, 324, 17)).toBe("00000000000019000");
  });

  it("genera el 190 con la abogada (clave G) y la provincia de su ficha", async () => {
    const lines = (await generate("r-190")).text.split("\r\n");
    expect(at(lines[0], 1, 17)).toBe("1190202612345678Z");
    expect(at(lines[0], 136, 9)).toBe("000000001");
    expect(at(lines[1], 18, 9)).toBe("00000000T");
    expect(at(lines[1], 76, 5)).toBe("28G01");
    expect(at(lines[1], 81, 14)).toBe(" 0000000100000");
    expect(at(lines[1], 95, 13)).toBe("0000000015000");
  });

  it("genera el 180 con el inmueble del arrendador", async () => {
    const lines = (await generate("r-180")).text.split("\r\n");
    expect(at(lines[1], 18, 9)).toBe("B12345674");
    expect(at(lines[1], 76, 3)).toBe("281");
    expect(at(lines[1], 93, 4)).toBe("1900");
    expect(at(lines[1], 115, 20)).toBe("9872023VH5797S0001WX");
    expect(at(lines[1], 323, 5)).toBe("28013");
  });

  it("genera el 193 con la fecha de pago del dividendo y pide la provincia si falta", async () => {
    await expect(generate("r-193")).rejects.toThrow(/provincia/);
    const lines = (await generate("r-193", { defaultProvince: "46" })).text.split("\r\n");
    expect(at(lines[1], 77, 2)).toBe("46");
    expect(at(lines[1], 92, 3)).toBe("A02");
    expect(at(lines[1], 331, 8)).toBe("20032026");
  });

  it("exporta el 190 a CSV y a PDF con las casillas y los perceptores", async () => {
    const summary = await calculateSpanishFiscalSummary(COMPANY, "190", "2026");
    const csv = fiscalSummaryToCsv(summary);
    expect(csv).toMatch(/Perceptores 190 · dinerario;G\.01;Abogada Núñez;00000000T;1000,00/);
    expect(csv).toMatch(/Cuadre con las autoliquidaciones/);
    const pdf = await renderFiscalReportPdf({ companyName: "Taller Peñón", summary });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);
});
