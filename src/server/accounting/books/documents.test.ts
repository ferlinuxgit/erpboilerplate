import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import { annualAccountsDocument } from "@/server/accounting/annual-accounts/documents";
import { buildEquityChangesStatement, buildRecognizedIncomeStatement } from "@/server/accounting/annual-accounts/equity-changes-model";
import { fixedAssetTables } from "@/server/accounting/annual-accounts/notes-model";
import { fileFingerprint, orderJournal, type BookEntry, type BookLine } from "@/server/accounting/books/books-model";
import { documentRowCount, renderDocumentXlsx } from "@/server/accounting/books/document";
import { renderDocumentPdf } from "@/server/accounting/books/document-pdf";
import { inventoryBookDocument, journalDocument, ledgerDocument, type BookHeader } from "@/server/accounting/books/documents";
import { fingerprintsText, legaliaInstructions } from "@/server/accounting/books/service";
import { buildOfficialStatements, officialStatementModelInfo } from "@/server/accounting/official-statements-model";
import type { StatementAccountRow } from "@/server/accounting/statements-model";


vi.mock("@/lib/db", () => ({ db: {} }));

const line = (code: string, name: string, debit: number, credit: number): BookLine => ({ accountId: `id-${code}`, accountCode: code, accountName: name, concept: null, debitCents: debit, creditCents: credit });
const entry = (number: string, day: string, kind: BookEntry["kind"], lines: BookLine[]): BookEntry => ({ id: number, number, day, postedAt: new Date(`${day}T10:00:00Z`), reference: `Ref ${number}`, kind, lines });

const header: BookHeader = { companyName: "Ejemplo, S.L.", taxId: "B12345678", yearCode: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) };
const journal = orderJournal([
  entry("AS-2026/000001", "2026-01-01", "opening", [line("57200001", "Banco", 300_000, 0), line("10000000", "Capital social", 0, 300_000)]),
  entry("AS-2026/000002", "2026-02-10", "normal", [line("70000000", "Ventas", 0, 100_000), line("57200001", "Banco", 100_000, 0)]),
]);
const generatedAt = new Date(Date.UTC(2027, 0, 15));

function row(code: string, values: Partial<StatementAccountRow>): StatementAccountRow {
  return { accountId: `acc-${code}`, code, name: `Cuenta ${code}`, type: "MIXED", priorCents: 0, debitCents: 0, creditCents: 0, yearToDateCents: 0, ...values };
}

async function sheetNames(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
  return workbook.worksheets.map((sheet) => sheet.name);
}

describe("libros como documentos", () => {
  it("el Diario lleva número de orden, primero el debe y las sumas al final", () => {
    const document = journalDocument(header, journal);
    const rows = document.sections[0].tables![0].rows;
    expect(rows[2].cells.slice(0, 5)).toEqual(["2", "10/02/2026", "AS-2026/000002", "57200001", "Banco"]);
    expect(rows[3].cells.slice(0, 4)).toEqual(["", "", "", "70000000"]);
    expect(rows.at(-1)).toMatchObject({ cells: ["", "", "", "", "", "SUMAS DEL DIARIO", 4000, 4000], strong: true });
    expect(document.subtitle).toBe("Ejemplo, S.L. · NIF B12345678 · Ejercicio 2026 (01/01/2026 a 31/12/2026)");
  });

  it("el Mayor agrupa por cuenta con sumas y saldo final", () => {
    const rows = ledgerDocument(header, journal, []).sections[0].tables![0].rows;
    expect(rows[0].cells[0]).toBe("10000000 Capital social");
    expect(rows.find((item) => item.cells[3] === "Sumas y saldo final" && item.cells[6] === 4000)).toBeDefined();
  });

  it("el libro de Inventarios trae balance inicial, cuatro balances trimestrales, inventario y las cuentas anuales", () => {
    const document = inventoryBookDocument(header, journal, [], [{ heading: "Balance al cierre", tables: [] }]);
    expect(document.sections.map((section) => section.sheetName ?? section.heading)).toEqual([
      "Balance inicial", "Sumas y saldos T1", "Sumas y saldos T2", "Sumas y saldos T3", "Sumas y saldos T4", "Inventario de cierre", "Balance al cierre",
    ]);
    // Inventario de cierre sin regularizar: el resultado figura aparte y cuadra.
    const closing = document.sections[5].tables!;
    expect(closing[0].rows.at(-1)?.cells).toEqual(["", "Total activo", 4000]);
    expect(closing[1].rows.at(-1)?.cells).toEqual(["", "Total patrimonio neto y pasivo", 4000]);
  });
});

describe("generación de ficheros", () => {
  it("genera el XLSX con una hoja por sección", async () => {
    const bytes = await renderDocumentXlsx(inventoryBookDocument(header, journal, [], []), generatedAt);
    expect(await sheetNames(bytes)).toEqual(["Balance inicial", "Sumas y saldos T1", "Sumas y saldos T2", "Sumas y saldos T3", "Sumas y saldos T4", "Inventario de cierre"]);
    expect(fileFingerprint(bytes).sha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("genera el PDF del Diario", async () => {
    const bytes = await renderDocumentPdf(journalDocument(header, journal), generatedAt);
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }, 60_000);

  it("rechaza un PDF con demasiadas filas y propone Excel", async () => {
    const big = { title: "Libro", subtitle: "", sections: [{ heading: "x", tables: [{ columns: [{ header: "a" }], rows: Array.from({ length: 6001 }, () => ({ cells: ["x"] })) }] }] };
    expect(documentRowCount(big)).toBe(6001);
    await expect(renderDocumentPdf(big, generatedAt)).rejects.toThrow(/Excel/);
  });

  it("genera las cuentas anuales completas en XLSX y PDF", async () => {
    const rows = [
      row("10000000", { priorCents: -300_000 }),
      row("57200001", { priorCents: 300_000, debitCents: 100_000 }),
      row("70000000", { creditCents: 100_000, yearToDateCents: -100_000 }),
    ];
    const statements = buildOfficialStatements(rows, null, "abbreviated");
    const document = annualAccountsDocument({
      company: { name: "Ejemplo, S.L.", taxId: "B12345678" },
      year: { code: "2026", endsAt: header.endsAt },
      previousYear: null,
      modelInfo: officialStatementModelInfo("abbreviated"),
      statements,
      equityChanges: buildEquityChangesStatement({ label: "2026", opening: [{ code: "10000000", cents: 300_000 }], pendingPriorResultCents: 0, yearResultCents: 100_000, entries: [] }, null, "abbreviated"),
      recognizedIncome: buildRecognizedIncomeStatement({ yearResultCents: 100_000, accounts: rows }, null),
      notes: [
        { title: "1. Actividad de la empresa", text: "La sociedad se dedica a…\n\nSegundo párrafo.", tables: [] },
        { title: "4. Inmovilizado material, intangible e inversiones inmobiliarias", text: "Cuadro:", tables: fixedAssetTables(rows) },
      ],
    });
    expect(document.sections.map((section) => section.sheetName)).toEqual(["Balance", "Pérdidas y ganancias", "Ingresos y gastos reconocidos", "Cambios patrimonio neto", "Memoria 1", "Memoria 2"]);
    expect(await sheetNames(await renderDocumentXlsx(document, generatedAt))).toHaveLength(6);
    const pdf = await renderDocumentPdf(document, generatedAt);
    expect(new TextDecoder("latin1").decode(pdf.slice(0, 5))).toBe("%PDF-");
  }, 60_000);
});

describe("relación de huellas e instrucciones", () => {
  const files = [{ name: "DIARIO_2026.xlsx", book: "Libro Diario", bytes: 1234, sha256Hex: "ab".repeat(32), sha256Base64: "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s=" }];

  it("lista cada fichero con su huella en hexadecimal y en base64", () => {
    const text = fingerprintsText(header, files, generatedAt);
    expect(text).toContain("DIARIO_2026.xlsx (1234 bytes)");
    expect(text).toContain(`SHA-256 (hexadecimal): ${"ab".repeat(32)}`);
    expect(text).toContain("SHA-256 (base64):      q6ur");
  });

  it("explica cómo cargarlos en Legalia 2 con las fechas del ejercicio", () => {
    const text = legaliaInstructions(header, files);
    expect(text).toContain("DIARIO_2026.xlsx  →  tipo «Libro Diario»");
    expect(text).toContain("fecha de apertura 01/01/2026 y fecha de cierre 31/12/2026");
    expect(text).toContain("cuatro meses");
  });
});
