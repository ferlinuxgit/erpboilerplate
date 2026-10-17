import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildGestorPackageZip, GESTOR_PACKAGE_FILES, gestorPackageFileName, type GestorPackageData } from "@/server/accounting/gestor-package-model";

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
