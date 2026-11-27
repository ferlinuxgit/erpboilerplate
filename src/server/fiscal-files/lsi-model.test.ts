import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildReceivedRegisterRows, type ReceivedRegisterLine } from "@/server/accounting/gestor-package-model";
import {
  assetTypeForAccount, buildLsiAssetRows, buildLsiIssuedRows, buildLsiReceivedRows, buildLsiWorkbook, counterpartyId, expenseConceptForAccount,
  LSI_ASSET_COLUMNS, LSI_ISSUED_COLUMNS, LSI_RECEIVED_COLUMNS, lsiFileName, splitInvoiceNumber,
  type LsiAsset, type LsiIssuedLine, type LsiOptions, type LsiReceivedExtra,
} from "@/server/fiscal-files/lsi-model";

const civilDate = (instant: Date) => ({ year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() });
const company: LsiOptions = { isIndividual: false, civilDate };
const person: LsiOptions = { isIndividual: true, civilDate, activity: { code: "a", type: "03", iaeGroup: "6533" } };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Índice (0…) de una columna por su letra de Excel. */
const at = (letters: string) => letters.split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;

const issuedLine = (overrides: Partial<LsiIssuedLine>): LsiIssuedLine => ({
  invoiceId: "f1", number: "F-2026/0001", issueDate: day("2026-04-03"), operationDate: null, accrualDate: day("2026-04-03"),
  invoiceType: "INVOICE", rectificationReason: null, treatment: "DOMESTIC", exemptionCode: null,
  customerName: "Cliente Uno, S.A.", customerTaxId: "A58818501", customerCountry: "ES",
  baseCents: 100_000, vatRate: 21, vatCents: 21_000, surchargeRate: null, surchargeCents: 0, withholdingRate: 0, withholdingCents: 0,
  ...overrides,
});

describe("diseño de columnas de los libros de la AEAT", () => {
  it("tiene el número de columnas de la plantilla oficial", () => {
    expect(LSI_ISSUED_COLUMNS).toHaveLength(36);
    expect(LSI_RECEIVED_COLUMNS).toHaveLength(42);
    expect(LSI_ASSET_COLUMNS).toHaveLength(42);
  });

  it("coloca las columnas clave en la letra de la plantilla", () => {
    expect(LSI_ISSUED_COLUMNS[at("F")].group).toBe("Tipo de Factura");
    expect(LSI_ISSUED_COLUMNS[at("L")].sub).toBe("Número");
    expect(LSI_ISSUED_COLUMNS[at("R")].group).toBe("Clave de Operación");
    expect(LSI_ISSUED_COLUMNS[at("V")].group).toBe("Base\nImponible");
    expect(LSI_ISSUED_COLUMNS[at("Z")].group).toBe("Cuota Recargo Eq.");
    expect(LSI_ISSUED_COLUMNS[at("AF")].group).toBe("Importe Retenido\ndel IRPF");
    expect(LSI_ISSUED_COLUMNS[at("AJ")].group).toBe("Referencia Externa");
    expect(LSI_RECEIVED_COLUMNS[at("M")].group).toBe("Fecha\nRecepción");
    expect(LSI_RECEIVED_COLUMNS[at("T")].group).toBe("Clave de\nOperación");
    expect(LSI_RECEIVED_COLUMNS[at("X")]).toMatchObject({ group: "Periodo Deducción", sub: "Ejercicio" });
    expect(LSI_RECEIVED_COLUMNS[at("AA")].group).toBe("Base\nImponible");
    expect(LSI_RECEIVED_COLUMNS[at("AD")].group).toBe("Cuota Deducible");
    expect(LSI_RECEIVED_COLUMNS[at("AP")].group).toBe("Referencia Externa");
    expect(LSI_ASSET_COLUMNS[at("I")].group).toBe("Fecha Inicio\nUtilización");
    expect(LSI_ASSET_COLUMNS[at("Q")]).toMatchObject({ group: "Amortización", sub: "Pendiente" });
    expect(LSI_ASSET_COLUMNS[at("AD")]).toMatchObject({ group: "Año de Inicio Utilización", sub: "Cuota Deducible" });
    expect(LSI_ASSET_COLUMNS[at("AI")]).toMatchObject({ group: "Baja del Bien", sub: "Causa" });
    expect(LSI_ASSET_COLUMNS[at("AP")].group).toBe("Referencia Externa");
  });
});

describe("identificación de terceros y números", () => {
  it("distingue NIF español, NIF-IVA de la UE y documento extranjero", () => {
    expect(counterpartyId("ES-B12345674", "ES")).toEqual({ type: null, country: null, id: "B12345674" });
    expect(counterpartyId("12345678901", "FR")).toEqual({ type: "02", country: "FR", id: "FR12345678901" });
    expect(counterpartyId("EL123456789", "GR")).toEqual({ type: "02", country: "GR", id: "EL123456789" });
    expect(counterpartyId("98-7654321", "US")).toEqual({ type: "04", country: "US", id: "987654321" });
    expect(counterpartyId(null, "ES")).toEqual({ type: null, country: null, id: null });
  });

  it("pasa a la serie lo que no cabe en los 20 caracteres del número", () => {
    expect(splitInvoiceNumber("F-2026/0001")).toEqual({ series: null, number: "F-2026/0001" });
    expect(splitInvoiceNumber("RECT-TIENDA-CENTRO-2026/000123")).toEqual({ series: "RECT-TIEND", number: "A-CENTRO-2026/000123" });
  });
});

describe("libro de facturas expedidas", () => {
  it("genera una fila por factura y tipo, con recargo y retención", () => {
    const rows = buildLsiIssuedRows([
      issuedLine({ baseCents: 100_000, vatRate: 21, vatCents: 21_000, surchargeRate: 5.2, surchargeCents: 5_200, withholdingRate: 15, withholdingCents: 15_000 }),
      issuedLine({ baseCents: 50_000, vatRate: 21, vatCents: 10_500, surchargeRate: 5.2, surchargeCents: 2_600, withholdingRate: 15, withholdingCents: 7_500 }),
      issuedLine({ baseCents: 20_000, vatRate: 10, vatCents: 2_000 }),
    ], person);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveLength(36);
    const [high, low] = rows;
    expect(high.slice(0, 8)).toEqual([2026, "2T", "A", "03", "6533", "F1", "I01", 1500]);
    expect((high[at("I")] as Date).toISOString()).toBe("2026-04-03T00:00:00.000Z");
    expect(high[at("J")]).toBeNull();
    expect(high[at("L")]).toBe("F-2026/0001");
    expect(high.slice(at("N"), at("U"))).toEqual([null, null, "A58818501", "Cliente Uno, S.A.", "01", "S1", null]);
    // Total de la fila = base + cuota + recargo.
    expect(high.slice(at("U"), at("AA"))).toEqual([1893, 1500, 21, 315, 5.2, 78]);
    // La retención va una sola vez, en la primera fila de la factura.
    expect(high.slice(at("AE"), at("AG"))).toEqual([15, 225]);
    expect(low.slice(at("U"), at("AA"))).toEqual([220, 200, 10, 20, null, null]);
    expect(low.slice(at("AE"), at("AG"))).toEqual([null, null]);
  });

  it("deja vacías las columnas del IRPF en una sociedad", () => {
    const [row] = buildLsiIssuedRows([issuedLine({ withholdingRate: 15, withholdingCents: 15_000 })], company);
    expect(row.slice(2, 8)).toEqual([null, null, null, "F1", null, null]);
    expect(row.slice(at("AE"), at("AG"))).toEqual([null, null]);
  });

  it("califica exentas, no sujetas, inversión del sujeto pasivo y exportaciones", () => {
    const cell = (line: Partial<LsiIssuedLine>) => {
      const [row] = buildLsiIssuedRows([issuedLine({ vatRate: 0, vatCents: 0, ...line })], company);
      return { key: row[at("R")], qualification: row[at("S")], exemption: row[at("T")], total: row[at("U")], rate: row[at("W")], tax: row[at("X")] };
    };
    expect(cell({ treatment: "INTRA_EU", customerTaxId: "FR12345678901", customerCountry: "FR" })).toEqual({ key: "01", qualification: null, exemption: "E5", total: 1000, rate: null, tax: null });
    expect(cell({ treatment: "INTRA_EU_SERVICES" })).toMatchObject({ qualification: "N2", exemption: null });
    expect(cell({ treatment: "EXPORT" })).toMatchObject({ key: "02", exemption: "E2" });
    expect(cell({ treatment: "EXPORT", exemptionCode: "E3" })).toMatchObject({ exemption: "E3" });
    expect(cell({ treatment: "REVERSE_CHARGE" })).toEqual({ key: "01", qualification: "S2", exemption: null, total: 1000, rate: 0, tax: 0 });
    expect(cell({ treatment: "NOT_SUBJECT", exemptionCode: "N1" })).toMatchObject({ qualification: "N1" });
    expect(cell({ treatment: "EXEMPT" })).toMatchObject({ qualification: null, exemption: "E1" });
  });

  it("marca simplificadas, rectificativas y la fecha de operación", () => {
    const [simplified] = buildLsiIssuedRows([issuedLine({ customerTaxId: null })], company);
    expect(simplified[at("F")]).toBe("F2");
    expect(simplified[at("P")]).toBeNull();
    expect(simplified[at("Q")]).toBe("VENTAS A CONSUMIDOR FINAL");

    const [credit] = buildLsiIssuedRows([issuedLine({ invoiceType: "CREDIT_NOTE", rectificationReason: "R1", baseCents: -10_000, vatCents: -2_100 })], company);
    expect(credit[at("F")]).toBe("R1");
    expect(credit.slice(at("U"), at("Y"))).toEqual([-121, -100, 21, -21]);
    const [creditSimplified] = buildLsiIssuedRows([issuedLine({ invoiceType: "CREDIT_NOTE", customerTaxId: null })], company);
    expect(creditSimplified[at("F")]).toBe("R5");

    // Operación de marzo facturada en abril: el periodo es el del devengo (1T).
    const [accrued] = buildLsiIssuedRows([issuedLine({ operationDate: day("2026-03-30"), accrualDate: day("2026-03-30") })], company);
    expect(accrued.slice(0, 2)).toEqual([2026, "1T"]);
    expect((accrued[at("J")] as Date).toISOString()).toBe("2026-03-30T00:00:00.000Z");
  });
});

describe("libro de facturas recibidas", () => {
  const line = (overrides: Partial<ReceivedRegisterLine>): ReceivedRegisterLine => ({
    invoiceId: "c1", number: "FR-0001", supplierNumber: "A/77", supplierName: "Proveedor, S.L.", supplierTaxId: "B12345674",
    issueDate: day("2026-01-10"), registrationDate: day("2026-01-15"), operationDate: null, documentKind: "INVOICE",
    rectifiedDocumentNumber: null, rectifiedIssueDate: null, vatTreatment: "DOMESTIC", isSimplified: false, importDuaNumber: null, importDuaDate: null,
    totalAmount: 0, prorrataPct: 100, base: 1000, taxRate: 21, taxAmount: 210, taxDeductiblePct: 100, surchargeRate: 0, surchargeAmount: 0,
    retentionAmount: 0, isInvestmentGood: false,
    ...overrides,
  });
  const extra = (overrides: Partial<LsiReceivedExtra> = {}): LsiReceivedExtra => ({
    supplierCountry: "ES", isSimplified: false, rectificationReason: null, importDuaNumber: null, importDuaDate: null, expenseConcept: "G01", retentionRate: 0, investmentGood: false,
    ...overrides,
  });
  const build = (input: Partial<ReceivedRegisterLine>, extras: Partial<LsiReceivedExtra> = {}, options = company) => {
    const [row] = buildReceivedRegisterRows([line(input)]);
    return buildLsiReceivedRows([{ row, extra: extra(extras) }], options)[0];
  };

  it("anota una factura nacional con su cuota deducible", () => {
    const row = build({ taxDeductiblePct: 50 });
    expect(row).toHaveLength(42);
    expect(row.slice(0, 8)).toEqual([2026, "1T", null, null, null, "F1", null, null]);
    expect(row[at("K")]).toBe("A/77");
    expect((row[at("M")] as Date).toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(row[at("N")]).toBe("FR-0001");
    expect(row.slice(at("P"), at("Z"))).toEqual([null, null, "B12345674", "Proveedor, S.L.", "01", "N", "N", "N", null, null]);
    expect(row.slice(at("Z"), at("AG"))).toEqual([1210, 1000, 21, 210, 105, null, null]);
  });

  it("rellena el concepto de gasto y la retención de un autónomo", () => {
    const row = build({ retentionAmount: 150 }, { expenseConcept: "G19", retentionRate: 15 }, person);
    expect(row.slice(2, 8)).toEqual(["A", "03", "6533", "F1", "G19", 1000]);
    expect(row.slice(at("AK"), at("AM"))).toEqual([15, 150]);
  });

  it("marca adquisiciones intracomunitarias, inversión del sujeto pasivo, importaciones y bienes de inversión", () => {
    const intra = build({ vatTreatment: "INTRA_EU", taxAmount: 0, supplierTaxId: "DE123456789" }, { supplierCountry: "DE" });
    expect(intra.slice(at("P"), at("S"))).toEqual(["02", "DE", "DE123456789"]);
    expect(intra[at("T")]).toBe("09");
    expect(intra[at("V")]).toBe("N");
    // El proveedor no repercute: el total es la base y la cuota es la autorrepercutida.
    expect(intra.slice(at("Z"), at("AE"))).toEqual([1000, 1000, 21, 210, 210]);

    const reverse = build({ vatTreatment: "REVERSE_CHARGE", taxAmount: 0 });
    expect(reverse.slice(at("T"), at("W"))).toEqual(["01", "N", "S"]);

    const dua = build({ vatTreatment: "IMPORT" }, { importDuaNumber: "26ES00280112345678", importDuaDate: day("2026-01-12") });
    expect(dua[at("F")]).toBe("F5");
    expect(dua[at("K")]).toBe("26ES00280112345678");
    expect((dua[at("I")] as Date).toISOString()).toBe("2026-01-12T00:00:00.000Z");
    expect(build({ vatTreatment: "IMPORT" })[at("T")]).toBe("13");

    expect(build({}, { investmentGood: true })[at("U")]).toBe("S");
  });

  it("anota rectificativas y anulaciones en negativo", () => {
    const credit = build({ documentKind: "RECTIFICATION", base: -100, taxAmount: -21 }, { rectificationReason: "R1" });
    expect(credit[at("F")]).toBe("R1");
    expect(credit.slice(at("Z"), at("AE"))).toEqual([-121, -100, 21, -21, -21]);
    const voided = build({ sign: -1, registrationDate: day("2026-05-02") });
    expect(voided.slice(0, 2)).toEqual([2026, "2T"]);
    expect(voided[at("N")]).toBe("FR-0001");
    expect(voided[at("AA")]).toBe(-1000);
  });
});

describe("libro de bienes de inversión", () => {
  const asset: LsiAsset = {
    identifier: "BI-0001", description: "Furgoneta de reparto", assetAccountCode: "218", inServiceDate: "2025-03-01",
    acquisitionCostCents: 2_000_000, amortizableCents: 1_800_000, annualPct: 16, accumulatedAtStartCents: 240_000, yearDepreciationCents: 288_000,
    invoice: { issueDate: day("2025-02-20"), supplierNumber: "V-55", number: "FR-0009", supplierName: "Concesionario, S.A.", supplierTaxId: "A58818501", supplierCountry: "ES", baseCents: 2_000_000, vatRate: 21, prorrataPct: 100, deductibleCents: 210_000 },
    disposalDate: "2026-11-30", disposalType: "sale",
  };

  it("anota el bien con su amortización, su factura y su baja (autónomo)", () => {
    const [row] = buildLsiAssetRows([asset], 2026, person);
    expect(row).toHaveLength(42);
    expect(row.slice(0, 8)).toEqual([2026, "4T", "A", "03", "6533", "22", "BI-0001", "Furgoneta de reparto"]);
    expect((row[at("I")] as Date).toISOString()).toBe("2025-03-01T00:00:00.000Z");
    expect(row.slice(at("J"), at("R"))).toEqual([20000, 18000, "01", 16, 2400, 2880, 5280, 12720]);
    expect(row.slice(at("S"), at("AE"))).toEqual(["V-55", null, "FR-0009", null, null, null, "A58818501", "Concesionario, S.A.", 20000, 21, 100, 2100]);
    expect(row.slice(at("AE"), at("AH"))).toEqual([null, null, null]);
    expect((row[at("AH")] as Date).toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(row[at("AI")]).toBe("02");
  });

  it("deja sin contenido las columnas del IRPF en una sociedad", () => {
    const [row] = buildLsiAssetRows([{ ...asset, disposalDate: null, disposalType: null }], 2026, company);
    expect(row.slice(at("J"), at("R"))).toEqual([null, null, null, null, null, null, null, null]);
    expect(row[at("AA")]).toBe(20000);
    expect(row.slice(at("AH"), at("AJ"))).toEqual([null, null]);
  });

  it("propone el tipo de bien y el concepto de gasto por cuenta", () => {
    expect(assetTypeForAccount("217")).toBe("23");
    expect(assetTypeForAccount("206")).toBe("33");
    expect(assetTypeForAccount("211")).toBe("12");
    expect(assetTypeForAccount(null)).toBe("29");
    expect(expenseConceptForAccount("600")).toBe("G01");
    expect(expenseConceptForAccount("621")).toBe("G12");
    expect(expenseConceptForAccount("623")).toBe("G19");
    expect(expenseConceptForAccount("629")).toBe("G22");
    expect(expenseConceptForAccount("217")).toBe("");
  });
});

describe("fichero XLSX", () => {
  it("lleva el nombre oficial y una pestaña por libro con tres filas de cabecera", async () => {
    const issued = buildLsiIssuedRows([issuedLine({})], company);
    const books = { year: 2026, taxId: "ES B-12345674", name: "Peñón & Hijos, S.L.", isIndividual: false, issued, received: [], assets: [] };
    expect(lsiFileName(books)).toBe("2026B12345674CPEÑON HIJOS S L.xlsx");
    expect(lsiFileName({ ...books, isIndividual: true })).toBe("2026B12345674TPEÑON HIJOS S L.xlsx");

    const workbook = new ExcelJS.Workbook();
    const bytes = await buildLsiWorkbook(books);
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["EXPEDIDAS", "RECIBIDAS", "BIENES-INVERSIÓN"]);
    const sheet = workbook.getWorksheet("EXPEDIDAS") as ExcelJS.Worksheet;
    expect(sheet.getCell("A1").value).toBe("Autoliquidación");
    expect(sheet.getCell("A2").value).toBe("Ejercicio");
    expect(sheet.getCell("B2").value).toBe("Periodo");
    expect(sheet.getCell("A3").value).toBe("Decimal (4,0)");
    expect(sheet.getCell("K1").value).toBe("Identificación de la Factura");
    expect(sheet.getCell("L2").value).toBe("Número");
    expect(sheet.getCell("AJ3").value).toBe("Alfanumérico (40)");
    // Asientos desde la fila 4: números y fechas como tales, no como texto.
    expect(sheet.getCell("A4").value).toBe(2026);
    expect(sheet.getCell("F4").value).toBe("F1");
    expect(sheet.getCell("I4").value).toBeInstanceOf(Date);
    expect(sheet.getCell("I4").numFmt).toBe("dd/mm/yyyy");
    expect(sheet.getCell("V4").value).toBe(1000);
    expect(sheet.getCell("V4").numFmt).toBe("0.00");
    expect(sheet.rowCount).toBe(4);
    expect(workbook.getWorksheet("RECIBIDAS")?.getCell("AP3").value).toBe("Alfanumérico (40)");
    expect(workbook.getWorksheet("BIENES-INVERSIÓN")?.getCell("AP3").value).toBe("Alfanumérico (40)");

    const unified = new ExcelJS.Workbook();
    await unified.xlsx.load((await buildLsiWorkbook({ ...books, isIndividual: true })).buffer as ArrayBuffer);
    expect(unified.worksheets.map((worksheet) => worksheet.name)).toEqual(["EXPEDIDAS_INGRESOS", "RECIBIDAS_GASTOS", "BIENES-INVERSIÓN"]);
  });
});
