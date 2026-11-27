import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildGestorPackageZip, buildReceivedRegisterRows, GESTOR_PACKAGE_FILES, gestorPackageFileName, type GestorPackageData, type ReceivedRegisterLine } from "@/server/accounting/gestor-package-model";

function fixture(overrides: Partial<GestorPackageData> = {}): GestorPackageData {
  const postedAt = new Date("2026-02-10T00:00:00.000Z");
  return {
    companyName: "Ferretería Núñez S.L.",
    companyTaxId: "B12345674",
    periodLabel: "1.º trimestre 2026",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-03-31T00:00:00.000Z"),
    journal: [
      { entryId: "e1", number: "AS-000001", postedAt, reference: "F-2026/0001", origin: "Factura emitida", accountCode: "4300", accountName: "Clientes", debit: 121, credit: 0 },
      { entryId: "e1", number: "AS-000001", postedAt, reference: "F-2026/0001", origin: "Factura emitida", accountCode: "700", accountName: "Ventas", debit: 0, credit: 100 },
      { entryId: "e1", number: "AS-000001", postedAt, reference: "F-2026/0001", origin: "Factura emitida", accountCode: "477", accountName: "IVA repercutido", debit: 0, credit: 21 },
    ],
    openingBalances: new Map([["572", 500]]),
    trialBalance: [
      { accountId: "a1", code: "4300", name: "Clientes", opening: 0, debit: 121, credit: 0, closing: 121 },
      { accountId: "a2", code: "477", name: "IVA repercutido", opening: 0, debit: 0, credit: 21, closing: -21 },
      { accountId: "a3", code: "572", name: "Bancos", opening: 500, debit: 0, credit: 0, closing: 500 },
      { accountId: "a4", code: "700", name: "Ventas", opening: 0, debit: 0, credit: 100, closing: -100 },
    ],
    vatIssued: [
      { id: "i1", issueDate: "2026-02-10T00:00:00.000Z", number: "F-2026/0001", supplierNumber: null, counterpartyName: "Cliente S.A.", counterpartyTaxId: "A87654321", vatTreatment: "DOMESTIC", taxBase: 100, taxAmount: 21, withholdingAmount: 0, totalAmount: 121 },
    ],
    vatReceived: [],
    modelPdfs: [{ fileName: "modelo-303-2026-Q1.pdf", bytes: new Uint8Array([37, 80, 68, 70]) }],
    generatedAt: new Date("2026-04-02T08:00:00.000Z"),
    ...overrides,
  };
}

async function readSheet(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe("paquete para el gestor", () => {
  it("contiene los libros, el LEEME y los PDF de los modelos del periodo", async () => {
    const { bytes, fileNames } = await buildGestorPackageZip(fixture());
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      GESTOR_PACKAGE_FILES.readme,
      GESTOR_PACKAGE_FILES.journal,
      GESTOR_PACKAGE_FILES.vatIssued,
      GESTOR_PACKAGE_FILES.vatReceived,
      GESTOR_PACKAGE_FILES.ledger,
      "modelos/modelo-303-2026-Q1.pdf",
      GESTOR_PACKAGE_FILES.trialBalance,
    ].sort());
    expect(fileNames).toHaveLength(7);
    const readme = strFromU8(files[GESTOR_PACKAGE_FILES.readme]);
    expect(readme).toContain("Ferretería Núñez S.L. (B12345674)");
    expect(readme).toContain("del 2026-01-01 al 2026-03-31");
    expect(readme).toContain("3 líneas");
  });

  it("el libro diario lleva cada línea del asiento (no solo el total) y cuadra", async () => {
    const files = unzipSync((await buildGestorPackageZip(fixture())).bytes);
    const rows = await readSheet(files[GESTOR_PACKAGE_FILES.journal]);
    expect(rows[0]).toEqual(["Fecha", "Asiento", "Concepto", "Origen", "Cuenta", "Nombre de la cuenta", "Debe", "Haber"]);
    expect(rows.slice(1, 4).map((row) => row[4])).toEqual(["4300", "700", "477"]);
    const total = rows[rows.length - 1];
    expect(total[2]).toBe("Total del periodo");
    expect(total[6]).toBe(121);
    expect(total[7]).toBe(121);
  });

  it("el mayor arranca con el saldo anterior y acumula; sumas y saldos separa deudor y acreedor", async () => {
    const files = unzipSync((await buildGestorPackageZip(fixture())).bytes);
    const ledger = await readSheet(files[GESTOR_PACKAGE_FILES.ledger]);
    const bank = ledger.filter((row) => row[0] === "572");
    expect(bank[0][4]).toBe("Saldo anterior");
    expect(bank[0][7]).toBe(500);
    const trial = await readSheet(files[GESTOR_PACKAGE_FILES.trialBalance]);
    const sales = trial.find((row) => row[0] === "700");
    expect(sales?.[5]).toBeUndefined();
    expect(sales?.[6]).toBe(100);
  });

  it("el libro registro de expedidas incluye cliente, NIF y tipo de operación en español", async () => {
    const files = unzipSync((await buildGestorPackageZip(fixture())).bytes);
    const rows = await readSheet(files[GESTOR_PACKAGE_FILES.vatIssued]);
    expect(rows[1].slice(1, 7)).toEqual(["F-2026/0001", "Cliente S.A.", "A87654321", "Nacional", 100, 21]);
  });

  it("el libro de recibidas separa la cuota cobrada del IVA autorrepercutido (intracomunitarias e ISP)", async () => {
    const received = (patch: Partial<GestorPackageData["vatReceived"][number]>) => ({
      id: "r1", issueDate: "2026-02-12T00:00:00.000Z", registrationDate: "2026-02-12T00:00:00.000Z", number: "FP-2026/0001", supplierNumber: "A-1",
      counterpartyName: "Suministros S.L.", counterpartyTaxId: "B12345674", vatTreatment: "DOMESTIC", taxBase: 100, taxAmount: 21, chargedTaxAmount: 21, withholdingAmount: 0, totalAmount: 121, ...patch,
    });
    const files = unzipSync((await buildGestorPackageZip(fixture({ vatReceived: [
      received({}),
      received({ id: "r2", number: "FP-2026/0002", counterpartyName: "Anthropic Ireland, Limited", counterpartyTaxId: "IE4276970QH", vatTreatment: "INTRA_EU", taxBase: 93.33, taxAmount: 19.6, chargedTaxAmount: 19.6, totalAmount: 93.33 }),
    ] }))).bytes);
    const rows = await readSheet(files[GESTOR_PACKAGE_FILES.vatReceived]);
    const header = rows[0] as string[];
    const value = (row: number, name: string) => rows[row][header.indexOf(name)] ?? null;
    expect([value(1, "Cuota soportada"), value(1, "IVA autorrepercutido"), value(1, "IVA deducible")]).toEqual([21, null, 21]);
    expect([value(2, "Base imponible"), value(2, "Cuota soportada"), value(2, "IVA autorrepercutido"), value(2, "IVA deducible"), value(2, "Total factura")]).toEqual([93.33, 0, 19.6, 19.6, 93.33]);
    expect([value(3, "Cuota soportada"), value(3, "IVA autorrepercutido"), value(3, "IVA deducible")]).toEqual([21, 19.6, 40.6]);
  });

  it("genera un nombre de fichero seguro", () => {
    expect(gestorPackageFileName("Ferretería Núñez S.L.", "1.º trimestre 2026")).toBe("paquete-gestor-ferreteria-nunez-s-l-1-trimestre-2026.zip");
  });
});

describe("libro registro de facturas recibidas por factura y tipo impositivo", () => {
  const registerLine = (patch: Partial<ReceivedRegisterLine> = {}): ReceivedRegisterLine => ({
    invoiceId: "si-1",
    number: "FP-2026/0001",
    supplierNumber: "A-118",
    supplierName: "Suministros Levante, S.L.",
    supplierTaxId: "B12345674",
    issueDate: new Date("2026-02-10T12:00:00.000Z"),
    registrationDate: new Date("2026-02-12T12:00:00.000Z"),
    operationDate: null,
    documentKind: "INVOICE",
    rectifiedDocumentNumber: null,
    rectifiedIssueDate: null,
    vatTreatment: "DOMESTIC",
    isSimplified: false,
    importDuaNumber: null,
    importDuaDate: null,
    totalAmount: "176.00",
    prorrataPct: "100",
    base: "100.00",
    taxRate: "21.000",
    taxAmount: "21.00",
    taxDeductiblePct: "100.000",
    surchargeRate: "0",
    surchargeAmount: "0",
    retentionAmount: "0",
    isInvestmentGood: false,
    ...patch,
  });

  it("una fila por factura y tipo: agrupa las líneas del mismo tipo y pone el total solo en la primera", () => {
    const rows = buildReceivedRegisterRows([
      registerLine(),
      registerLine({ base: "20.00", taxAmount: "4.20", taxDeductiblePct: "50" }),
      registerLine({ base: "30.00", taxRate: "10", taxAmount: "3.00", isInvestmentGood: true }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.taxRate, row.base, row.chargedTax, row.deductibleTax, row.totalAmount, row.investmentGood])).toEqual([
      [21, 120, 25.2, 23.1, 176, ""],
      [10, 30, 3, 3, null, "Sí"],
    ]);
    expect(rows[0]).toMatchObject({ documentClass: "Factura", rectifiedInvoice: "", selfAssessedTax: 0 });
  });

  it("una rectificativa conserva el signo y cita la factura que rectifica", () => {
    const [row] = buildReceivedRegisterRows([
      registerLine({
        invoiceId: "si-2", number: "FP-2026/0002", documentKind: "RECTIFICATION", rectifiedDocumentNumber: "A-118", rectifiedIssueDate: new Date("2026-02-10T12:00:00.000Z"),
        totalAmount: "-60.50", base: "-50.00", taxAmount: "-10.50",
      }),
    ]);
    expect(row).toMatchObject({ documentClass: "Rectificativa", rectifiedInvoice: "A-118 (10/02/2026)", base: -50, chargedTax: -10.5, deductibleTax: -10.5, totalAmount: -60.5 });
  });

  it("autorepercusión: la cuota no la cobra el proveedor; sin tipo en la línea se usa el general", () => {
    const rows = buildReceivedRegisterRows([
      registerLine({ invoiceId: "si-3", number: "FP-3", vatTreatment: "INTRA_EU", totalAmount: "100.00", taxRate: "0", taxAmount: "0" }),
      registerLine({ invoiceId: "si-4", number: "FP-4", vatTreatment: "REVERSE_CHARGE", documentKind: "RECTIFICATION", rectifiedDocumentNumber: "X-1", totalAmount: "-200.00", base: "-200.00", taxRate: "10", taxAmount: "-20.00" }),
    ]);
    expect(rows[0]).toMatchObject({ taxRate: 21, chargedTax: 0, selfAssessedTax: 21, deductibleTax: 21, totalAmount: 100 });
    expect(rows[1]).toMatchObject({ taxRate: 10, chargedTax: 0, selfAssessedTax: -20, deductibleTax: -20, totalAmount: -200 });
  });

  it("aplica la prorrata, separa el recargo de equivalencia y marca simplificadas, DUA y anulaciones", () => {
    const rows = buildReceivedRegisterRows([
      registerLine({ prorrataPct: "40", surchargeRate: "5.2", surchargeAmount: "5.20", totalAmount: "126.20", isSimplified: true, operationDate: new Date("2026-02-01T12:00:00.000Z") }),
      registerLine({ invoiceId: "si-5", number: "FP-5", vatTreatment: "IMPORT", importDuaNumber: "26ES0028", importDuaDate: new Date("2026-02-09T12:00:00.000Z"), retentionAmount: "15.00" }),
      registerLine({ invoiceId: "si-6", number: "FP-6", sign: -1, registrationDate: new Date("2026-03-01T12:00:00.000Z") }),
    ]);
    expect(rows[0]).toMatchObject({ documentClass: "Factura simplificada", deductibleTax: 8.4, surchargeRate: 5.2, surchargeAmount: 5.2, operationDate: new Date("2026-02-01T12:00:00.000Z") });
    expect(rows[1]).toMatchObject({ importDua: "26ES0028 (09/02/2026)", withholding: 15 });
    expect(rows[2]).toMatchObject({ number: "FP-6 (anulación)", documentClass: "Factura (anulación)", base: -100, chargedTax: -21, deductibleTax: -21, totalAmount: -176 });
  });

  it("el Excel de recibidas lleva una fila por tipo con tipo, base, cuota, deducible, recargo, clase y factura rectificada", async () => {
    const vatReceivedDetail = buildReceivedRegisterRows([
      registerLine(),
      registerLine({ base: "50.00", taxRate: "10", taxAmount: "5.00", taxDeductiblePct: "50" }),
      registerLine({ invoiceId: "si-2", number: "FP-2026/0002", documentKind: "RECTIFICATION", rectifiedDocumentNumber: "A-118", totalAmount: "-60.50", base: "-50.00", taxAmount: "-10.50", registrationDate: new Date("2026-02-20T12:00:00.000Z") }),
    ]);
    const files = unzipSync((await buildGestorPackageZip(fixture({ vatReceivedDetail }))).bytes);
    const rows = await readSheet(files[GESTOR_PACKAGE_FILES.vatReceived]);
    const header = rows[0] as string[];
    for (const name of ["Fecha de operación", "Clase", "Factura rectificada", "Tipo de operación", "Tipo IVA (%)", "Base imponible", "Cuota soportada", "Cuota deducible", "Tipo recargo (%)", "Recargo de equivalencia", "Bien de inversión"]) {
      expect(header).toContain(name);
    }
    const value = (row: number, name: string) => rows[row][header.indexOf(name)] ?? null;
    expect(rows).toHaveLength(5);
    expect([value(1, "Tipo IVA (%)"), value(1, "Base imponible"), value(1, "Cuota soportada"), value(1, "Cuota deducible"), value(1, "Total factura")]).toEqual([21, 100, 21, 21, 176]);
    expect([value(2, "Tipo IVA (%)"), value(2, "Base imponible"), value(2, "Cuota deducible"), value(2, "Total factura")]).toEqual([10, 50, 2.5, null]);
    expect([value(3, "Clase"), value(3, "Factura rectificada"), value(3, "Base imponible"), value(3, "Cuota soportada"), value(3, "Total factura")]).toEqual(["Rectificativa", "A-118", -50, -10.5, -60.5]);
    expect([value(4, "Proveedor"), value(4, "Base imponible"), value(4, "Cuota soportada"), value(4, "Cuota deducible"), value(4, "Total factura")]).toEqual(["Total", 100, 15.5, 13, 115.5]);
    expect(strFromU8(files[GESTOR_PACKAGE_FILES.readme])).toContain("una fila por factura y tipo impositivo");
  });
});
