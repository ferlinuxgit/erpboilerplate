import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Libros oficiales y cuentas anuales contra Postgres real (PGlite en memoria): carga del ejercicio en
 * hora local, juego para legalizar con sus huellas, anotación de la presentación, aviso al modificar
 * un ejercicio legalizado, exportación del diario y cuentas anuales con memoria guardada.
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
import { accountChart, company, fiscalYear, journal, journalEntry, journalLine, partner, supplierInvoice, supplierInvoicePayment, supplierPayment, tenant, user } from "@/db/schema";
import { getAnnualAccountsModel, loadAnnualAccounts, saveAnnualAccountsNotes, setAnnualAccountsModel } from "@/server/accounting/annual-accounts/service";
import { fileFingerprint } from "@/server/accounting/books/books-model";
import { exportDiary, findBooksLegalization, generateBook, generateBooksPackage, getBooksOverview, loadBookData, registerBooksSubmission, unregisterBooksSubmission } from "@/server/accounting/books/service";

const COMPANY = "company-1";
const actor = { companyId: COMPANY, tenantId: "tenant-1", actorUserId: "user-1" };
const utc = (...parts: [number, number, number, number?, number?, number?]) => new Date(Date.UTC(...parts));

type Line = [accountId: string, debit: string, credit: string];

async function addEntry(id: string, number: string, postedAt: Date, lines: Line[], sourceType: string | null = null) {
  await state.db.insert(journalEntry).values({ id, companyId: COMPANY, number, journalId: "j1", postedAt, reference: `Ref ${number}`, sourceType, sourceId: sourceType ? "fy-2026" : null });
  await state.db.insert(journalLine).values(lines.map(([accountId, debit, credit], index) => ({ journalEntryId: id, accountId, debit, credit, lineNumber: index + 1 })));
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Ejemplo", legalName: "Ejemplo, S.L.", vatNumber: "B12345678", countryCode: "ES", postalCode: "28001", city: "Madrid", fiscalAddress: "Calle Mayor 1" });
  await state.db.insert(fiscalYear).values([
    { id: "fy-2025", companyId: COMPANY, code: "2025", startsAt: utc(2025, 0, 1), endsAt: utc(2025, 11, 31), isClosed: true },
    { id: "fy-2026", companyId: COMPANY, code: "2026", startsAt: utc(2026, 0, 1), endsAt: utc(2026, 11, 31), isClosed: true },
  ]);
  await state.db.insert(journal).values({ id: "j1", companyId: COMPANY, code: "GEN", name: "General" });
  await state.db.insert(partner).values({ id: "p1", companyId: COMPANY, number: "P-0001", name: "Suministros Peña, S.A.", taxId: "A87654321", city: "Madrid", postalCode: "28002" });
  await state.db.insert(accountChart).values([
    { id: "a100", companyId: COMPANY, code: "10000000", name: "Capital social", type: "EQUITY" },
    { id: "a112", companyId: COMPANY, code: "11200000", name: "Reserva legal", type: "EQUITY" },
    { id: "a129", companyId: COMPANY, code: "12900000", name: "Resultado del ejercicio", type: "EQUITY" },
    { id: "a217", companyId: COMPANY, code: "21700000", name: "Equipos informáticos", type: "ASSET" },
    { id: "a400", companyId: COMPANY, code: "40000001", name: "Suministros Peña, S.A.", type: "LIABILITY", partnerId: "p1" },
    { id: "a572", companyId: COMPANY, code: "57200001", name: "Banco", type: "ASSET" },
    { id: "a600", companyId: COMPANY, code: "60000000", name: "Compras de mercaderías", type: "EXPENSE" },
    { id: "a700", companyId: COMPANY, code: "70000000", name: "Ventas de mercaderías", type: "REVENUE" },
  ]);

  // 2025: constitución con 3.000 € y 400 € de ventas; regularizado y cerrado.
  await addEntry("e25-1", "AS-2025/000001", utc(2025, 2, 1), [["a572", "3000", "0"], ["a100", "0", "3000"]]);
  await addEntry("e25-2", "AS-2025/000002", utc(2025, 5, 1), [["a572", "400", "0"], ["a700", "0", "400"]]);
  await state.db.insert(journalEntry).values({ id: "e25-3", companyId: COMPANY, number: "AS-2025/000003", journalId: "j1", postedAt: utc(2025, 11, 31, 22, 59, 58), sourceType: "fiscalYearRegularization", sourceId: "fy-2025" });
  await state.db.insert(journalLine).values([{ journalEntryId: "e25-3", accountId: "a700", debit: "400", credit: "0" }, { journalEntryId: "e25-3", accountId: "a129", debit: "0", credit: "400" }]);
  await state.db.insert(journalEntry).values({ id: "e25-4", companyId: COMPANY, number: "AS-2025/000004", journalId: "j1", postedAt: utc(2025, 11, 31, 22, 59, 59), sourceType: "fiscalYearClosing", sourceId: "fy-2025" });
  await state.db.insert(journalLine).values([{ journalEntryId: "e25-4", accountId: "a100", debit: "3000", credit: "0" }, { journalEntryId: "e25-4", accountId: "a129", debit: "400", credit: "0" }, { journalEntryId: "e25-4", accountId: "a572", debit: "0", credit: "3400" }]);

  // 2026: apertura, reparto del resultado a reservas, compra a crédito pagada a 30 días, ordenador,
  // venta y un ticket del 1 de enero a las 00:30 de Madrid (31-12-2025 23:30 UTC).
  await addEntry("e26-1", "AS-2026/000001", utc(2026, 0, 1), [["a572", "3400", "0"], ["a100", "0", "3000"], ["a129", "0", "400"]], "fiscalYearOpening");
  await addEntry("e26-2", "AS-2026/000002", utc(2026, 5, 30), [["a129", "400", "0"], ["a112", "0", "400"]]);
  await addEntry("e26-3", "AS-2026/000003", utc(2026, 2, 1), [["a600", "500", "0"], ["a400", "0", "500"]]);
  await addEntry("e26-4", "AS-2026/000004", utc(2026, 2, 31), [["a400", "500", "0"], ["a572", "0", "500"]]);
  await addEntry("e26-5", "AS-2026/000005", utc(2026, 3, 10), [["a217", "1000", "0"], ["a572", "0", "1000"]]);
  await addEntry("e26-6", "AS-2026/000006", utc(2026, 8, 15), [["a572", "2000", "0"], ["a700", "0", "2000"]]);
  await addEntry("e26-7", "AS-2026/000007", utc(2025, 11, 31, 23, 30), [["a572", "30", "0"], ["a700", "0", "30"]]);

  await state.db.insert(supplierInvoice).values({ id: "si-1", companyId: COMPANY, supplierPartnerId: "p1", number: "FR-1", issueDate: utc(2026, 2, 1), accountingDate: utc(2026, 2, 1), totalAmount: "500.00" });
  await state.db.insert(supplierPayment).values({ id: "sp-1", companyId: COMPANY, number: "PG-1", supplierPartnerId: "p1", amount: "500.00", postedAt: utc(2026, 2, 31) });
  await state.db.insert(supplierInvoicePayment).values({ companyId: COMPANY, supplierInvoiceId: "si-1", supplierPaymentId: "sp-1", amountApplied: "500.00" });
}, 120_000);

afterAll(async () => {
  await state.client?.close();
});

describe("carga del ejercicio", () => {
  it("incluye el ticket de las 00:30 del 1 de enero y no los asientos de cierre del año anterior", async () => {
    const data = await loadBookData(COMPANY, "fy-2026");
    expect(data.journal.map((entry) => [entry.order, entry.number, entry.day, entry.kind])).toEqual([
      [1, "AS-2026/000001", "2026-01-01", "opening"],
      [2, "AS-2026/000007", "2026-01-01", "normal"],
      [3, "AS-2026/000003", "2026-03-01", "normal"],
      [4, "AS-2026/000004", "2026-03-31", "normal"],
      [5, "AS-2026/000005", "2026-04-10", "normal"],
      [6, "AS-2026/000002", "2026-06-30", "normal"],
      [7, "AS-2026/000006", "2026-09-15", "normal"],
    ]);
    // 2025 se cerró: no quedan saldos anteriores (los trae el asiento de apertura).
    expect(data.prior).toEqual([]);
    expect(data.header).toMatchObject({ companyName: "Ejemplo, S.L.", taxId: "B12345678", yearCode: "2026" });
  });

  it("el ejercicio anterior termina con su regularización y su cierre", async () => {
    const data = await loadBookData(COMPANY, "fy-2025");
    expect(data.journal.map((entry) => entry.kind)).toEqual(["normal", "normal", "regularization", "closing"]);
  });
});

describe("cuentas anuales", () => {
  it("modelo abreviado por defecto, con ejercicio anterior, estado de cambios y memoria", async () => {
    expect(await getAnnualAccountsModel(COMPANY)).toBe("abbreviated");
    const accounts = await loadAnnualAccounts(COMPANY, "fy-2026");
    expect(accounts.model).toBe("abbreviated");
    expect(accounts.previousYear?.code).toBe("2025");
    expect(accounts.statements.difference).toBe(0);
    expect(accounts.statements.totals).toMatchObject({ assets: 4930, equityAndLiabilities: 4930, result: 1530 });
    expect(accounts.statements.assets.find((line) => line.id === "TOTAL_ACTIVO")).toMatchObject({ amount: 4930, previous: 3400 });
    expect(accounts.statements.incomeStatement.find((line) => line.id === "PG.1")).toMatchObject({ amount: 2030, previous: 400 });

    // Estado de cambios: el reparto del resultado es una variación interna; el saldo final cuadra con el balance.
    const rows = Object.fromEntries(accounts.equityChanges.rows.map((row) => [row.id, row]));
    expect(rows["previous.closing"].total).toBe(3400);
    expect(rows["current.opening"]).toMatchObject({ total: 3400, values: { capital: 3000, result: 400 } });
    expect(rows["current.other"]).toMatchObject({ total: 0, values: { result: -400, reserves: 400 } });
    expect(rows["current.closing"]).toMatchObject({ total: 4930, values: { capital: 3000, reserves: 400, result: 1530 } });
    expect(accounts.recognizedIncome?.lines.find((line) => line.id === "R.TOTAL")?.amount).toBe(1530);

    // Tamaño: microempresa con los datos disponibles.
    expect(accounts.size.current).toMatchObject({ assets: 4930, turnover: 2030, employees: null });
    expect(accounts.size.assessment).toMatchObject({ small: true, recommended: "abbreviated" });

    // Memoria: cuadro de inmovilizado y periodo medio de pago de la factura pagada a 30 días.
    const note4 = accounts.notes.find((note) => note.id === "4");
    expect(note4?.tables[0].rows[1].values).toEqual([0, 1000, 0, 1000]);
    const pmp = accounts.notes.find((note) => note.id === "pmp");
    expect(pmp?.tables[0].rows[0].values[0]).toBe("30,0 días");
    expect(accounts.notes.find((note) => note.id === "1")).toMatchObject({ isDefaultText: true });
  });

  it("guarda el modelo de la empresa y la memoria del ejercicio", async () => {
    await setAnnualAccountsModel({ ...actor, model: "pymes" });
    await saveAnnualAccountsNotes({ ...actor, fiscalYearId: "fy-2026", sections: { "1": "Venta de mercaderías al por menor.", inventada: "no se guarda" }, averageEmployees: 2.5, taxData: { permanentDifferences: "100.00" } });
    const accounts = await loadAnnualAccounts(COMPANY, "fy-2026");
    expect(accounts.model).toBe("pymes");
    expect(accounts.recognizedIncome).toBeNull();
    expect(accounts.equityChanges.columns).toHaveLength(10);
    expect(accounts.notes.find((note) => note.id === "1")).toMatchObject({ text: "Venta de mercaderías al por menor.", isDefaultText: false });
    expect(accounts.notesData).toEqual({ averageEmployees: 2.5, taxData: { permanentDifferences: "100.00" } });
    expect(accounts.size.current.employees).toBe(2.5);
    const tax = accounts.notes.find((note) => note.id === "8")?.tables[0];
    expect(tax?.rows.at(-1)?.values).toEqual([1630]);

    // Se puede ver en otro modelo sin cambiar el de la empresa; un texto vacío vuelve al de partida.
    const normal = await loadAnnualAccounts(COMPANY, "fy-2026", { model: "normal" });
    expect(normal).toMatchObject({ model: "normal", configuredModel: "pymes" });
    expect(normal.statements.difference).toBe(0);
    await saveAnnualAccountsNotes({ ...actor, fiscalYearId: "fy-2026", sections: { "1": "" } });
    expect((await loadAnnualAccounts(COMPANY, "fy-2026")).notes.find((note) => note.id === "1")?.isDefaultText).toBe(true);
    await setAnnualAccountsModel({ ...actor, model: "abbreviated" });
  });
});

describe("libros para legalizar", () => {
  it("genera un libro suelto", async () => {
    const { bytes, fileName, contentType } = await generateBook({ companyId: COMPANY, fiscalYearId: "fy-2026", kind: "journal", format: "xlsx" });
    expect(fileName).toBe("DIARIO_2026.xlsx");
    expect(contentType).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Diario"]);
  });

  it("genera el juego con huellas, lo anota y avisa si el ejercicio cambia después de presentarlo", async () => {
    const generated = await generateBooksPackage({ ...actor, fiscalYearId: "fy-2026", format: "xlsx" });
    expect(generated.fileName).toBe("libros-oficiales-2026.zip");
    const zip = unzipSync(generated.bytes);
    expect(Object.keys(zip).sort()).toEqual(["DIARIO_2026.xlsx", "HUELLAS.txt", "INSTRUCCIONES_LEGALIA2.txt", "INV_CUEN_2026.xlsx", "MAYOR_2026.xlsx"]);
    // La huella anotada es la del fichero que va en el ZIP.
    for (const file of generated.files) expect(fileFingerprint(zip[file.name]).sha256Hex).toBe(file.sha256Hex);
    const fingerprints = new TextDecoder().decode(zip["HUELLAS.txt"]);
    for (const file of generated.files) expect(fingerprints).toContain(file.sha256Hex);
    // El libro de Inventarios lleva las cuentas anuales.
    const inventory = new ExcelJS.Workbook();
    await inventory.xlsx.load(zip["INV_CUEN_2026.xlsx"].buffer as ArrayBuffer);
    expect(inventory.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["Balance inicial", "Sumas y saldos T4", "Inventario de cierre", "Balance", "Pérdidas y ganancias", "Cambios patrimonio neto", "Memoria 1"]));

    let overview = await getBooksOverview(COMPANY, "fy-2026");
    expect(overview).toMatchObject({ balanced: true, legalized: false, legalizedAndChanged: false, hasOpening: true, hasClosing: false, outOfOrder: 2 });
    expect(overview.totals).toMatchObject({ entries: 7, debit: 7830, credit: 7830 });
    expect(overview.submissions).toHaveLength(1);
    expect(overview.submissions[0]).toMatchObject({ id: generated.submissionId, status: "generated", changedSince: false, entryCount: 7 });

    // Un segundo juego sin presentar sustituye al primero.
    const again = await generateBooksPackage({ ...actor, fiscalYearId: "fy-2026", format: "xlsx" });
    expect((await getBooksOverview(COMPANY, "fy-2026")).submissions.map((submission) => submission.id)).toEqual([again.submissionId]);

    expect(await findBooksLegalization(COMPANY, "fy-2026")).toBeNull();
    await registerBooksSubmission({ ...actor, submissionId: again.submissionId, submittedAt: "2027-04-20", registryName: "Madrid", submissionReference: "1/2027/123" });
    expect(await findBooksLegalization(COMPANY, "fy-2026")).toMatchObject({ submittedAt: "2027-04-20", registryName: "Madrid" });
    overview = await getBooksOverview(COMPANY, "fy-2026");
    expect(overview).toMatchObject({ legalized: true, legalizedAndChanged: false });

    // Alguien añade un asiento con fecha del ejercicio legalizado.
    await addEntry("e26-8", "AS-2026/000008", utc(2026, 10, 2), [["a600", "10", "0"], ["a572", "0", "10"]]);
    overview = await getBooksOverview(COMPANY, "fy-2026");
    expect(overview).toMatchObject({ legalized: true, legalizedAndChanged: true });
    expect(overview.submissions[0].changedSince).toBe(true);

    await unregisterBooksSubmission({ ...actor, submissionId: again.submissionId });
    expect(await findBooksLegalization(COMPANY, "fy-2026")).toBeNull();
    await expect(registerBooksSubmission({ ...actor, submissionId: "no-existe", submittedAt: "2027-04-20" })).rejects.toThrow(/juego de libros/);
  }, 60_000);

  it("no genera libros de un ejercicio sin asientos ni de otra empresa", async () => {
    await state.db.insert(fiscalYear).values({ id: "fy-2027", companyId: COMPANY, code: "2027", startsAt: utc(2027, 0, 1), endsAt: utc(2027, 11, 31) });
    await expect(generateBooksPackage({ ...actor, fiscalYearId: "fy-2027", format: "xlsx" })).rejects.toThrow(/no tiene asientos/);
    await expect(loadBookData("otra-empresa", "fy-2026")).rejects.toThrow(/no encontrado/);
  });
});

describe("exportación del diario", () => {
  it("A3: SUENLACE.DAT con registros de 256 bytes", async () => {
    const { bytes, fileName } = await exportDiary({ ...actor, fiscalYearId: "fy-2026", format: "a3", a3CompanyCode: 12 });
    expect(fileName).toBe("SUENLACE.DAT");
    const text = new TextDecoder().decode(bytes);
    expect(bytes.byteLength % 256).toBe(0);
    expect(text.split("\r\n")[0].slice(0, 15)).toBe("400012202601010");
    await expect(exportDiary({ ...actor, fiscalYearId: "fy-2026", format: "a3" })).rejects.toThrow(/código de empresa/);
  });

  it("ContaPlus: ZIP con XDiario y XSubCta (con el NIF del tercero)", async () => {
    const { bytes, fileName } = await exportDiary({ ...actor, fiscalYearId: "fy-2026", format: "contaplus" });
    expect(fileName).toBe("contaplus-2026.zip");
    const zip = unzipSync(bytes);
    const diary = new TextDecoder().decode(zip["XDiario.txt"]).split("\r\n").filter(Boolean);
    expect(diary.every((record) => record.length === 347)).toBe(true);
    const accounts = new TextDecoder().decode(zip["XSubCta.txt"]).split("\r\n").filter(Boolean);
    const supplier = accounts.find((record) => record.startsWith("40000001"));
    expect(supplier?.slice(12, 52).trim()).toBe("Suministros Pena, S.A.");
    expect(supplier?.slice(52, 67).trim()).toBe("A87654321");
  });
});
