import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Asientos manuales contra Postgres real (PGlite en memoria):
 * - aviso de ejercicio con libros presentados a legalizar al crear, editar, revertir y reabrir;
 * - renumeración de los asientos de un ejercicio por fecha.
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
import { accountChart, auditLog, company, fiscalYear, journal, journalEntry, journalLine, officialBookSubmission, tenant, user } from "@/db/schema";
import { legalizedBooksWarning, legalizedYearForDate } from "@/server/accounting/books/legalization-model";
import { listLegalizedYears } from "@/server/accounting/books/legalization";
import { getFiscalYearLifecycle, reopenFiscalYear } from "@/server/accounting/fiscal-years";
import { planEntryRenumbering } from "@/server/accounting/renumber-model";
import { previewEntryRenumbering, renumberFiscalYearEntries } from "@/server/accounting/renumber";
import { createJournalEntry, deleteJournalEntry, updateJournalEntry } from "@/server/accounting/service";

const COMPANY = "company-1";
const actor = { companyId: COMPANY, tenantId: "tenant-1", actorUserId: "user-1" };
const utc = (...parts: [number, number, number, number?, number?, number?]) => new Date(Date.UTC(...parts));
const lines = (amount: string) => [{ accountId: "a570", debit: amount, credit: "0" }, { accountId: "a700", debit: "0", credit: amount }];

async function addEntry(id: string, number: string, postedAt: Date, fiscalYearId: string | null, extra: Partial<typeof journalEntry.$inferInsert> = {}) {
  await state.db.insert(journalEntry).values({ id, companyId: COMPANY, number, journalId: "j1", postedAt, reference: `Ref ${id}`, fiscalYearId, ...extra });
  await state.db.insert(journalLine).values([
    { journalEntryId: id, accountId: "a570", debit: "10.00", credit: "0", lineNumber: 1 },
    { journalEntryId: id, accountId: "a700", debit: "0", credit: "10.00", lineNumber: 2 },
  ]);
}

async function lastAudit(action: string) {
  const rows = await state.db.select().from(auditLog).where(eq(auditLog.action, action));
  const row = rows[rows.length - 1];
  return row ? JSON.parse(row.payload ?? "{}") : null;
}

async function numbersOf(fiscalYearId: string) {
  const rows = await state.db
    .select({ id: journalEntry.id, number: journalEntry.number })
    .from(journalEntry)
    .where(and(eq(journalEntry.companyId, COMPANY), eq(journalEntry.fiscalYearId, fiscalYearId)))
    .orderBy(asc(journalEntry.number));
  return rows.map((row: { id: string; number: string }) => `${row.number}=${row.id}`);
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Ejemplo", legalName: "Ejemplo, S.L.", vatNumber: "B12345678", countryCode: "ES", postalCode: "28001", city: "Madrid" });
  const year = new Date().getUTCFullYear();
  await state.db.insert(fiscalYear).values([
    // Ejercicio antiguo, abierto, con libros presentados a legalizar.
    { id: "fy-legal", companyId: COMPANY, code: "2020", startsAt: utc(2020, 0, 1), endsAt: utc(2020, 11, 31), nextJournalEntryNumber: 2 },
    // Ejercicio para renumerar.
    { id: "fy-2021", companyId: COMPANY, code: "2021", startsAt: utc(2021, 0, 1), endsAt: utc(2021, 11, 31), nextJournalEntryNumber: 9 },
    // Ejercicio cerrado (anterior a todos: no impide reabrir los demás).
    { id: "fy-2022", companyId: COMPANY, code: "2019", startsAt: utc(2019, 0, 1), endsAt: utc(2019, 11, 31), isClosed: true },
    // Ejercicio en curso (donde caen los contraasientos, fechados hoy).
    { id: "fy-now", companyId: COMPANY, code: String(year), startsAt: utc(year, 0, 1), endsAt: utc(year, 11, 31) },
  ]);
  await state.db.insert(journal).values({ id: "j1", companyId: COMPANY, code: "GEN", name: "General" });
  await state.db.insert(accountChart).values([
    { id: "a570", companyId: COMPANY, code: "57000000", name: "Caja", type: "ASSET" },
    { id: "a700", companyId: COMPANY, code: "70000000", name: "Ventas", type: "REVENUE" },
  ]);
  await addEntry("legal-1", "AS-2020/000001", utc(2020, 4, 10), "fy-legal");
  await state.db.insert(officialBookSubmission).values({
    id: "sub-1", companyId: COMPANY, fiscalYearId: "fy-legal", status: "submitted", files: [], ledgerFingerprint: "x", entryCount: 1, submittedAt: "2021-04-20", registryName: "Registro Mercantil de Madrid",
  });
});

describe("aviso de ejercicio legalizado (funciones puras)", () => {
  it("explica cuándo y dónde se presentaron los libros", () => {
    const text = legalizedBooksWarning({ yearCode: "2020", submittedAt: "2021-04-20", registryName: "Registro Mercantil de Madrid" });
    expect(text).toContain("ejercicio 2020");
    expect(text).toContain("20/04/2021");
    expect(text).toContain("Registro Mercantil de Madrid");
  });

  it("localiza el ejercicio legalizado de una fecha", () => {
    const years = [{ fiscalYearId: "fy-legal", code: "2020", from: "2020-01-01", to: "2020-12-31", submittedAt: null, registryName: null }];
    expect(legalizedYearForDate(years, "2020-12-31")?.code).toBe("2020");
    expect(legalizedYearForDate(years, "2021-01-01")).toBeNull();
    expect(legalizedYearForDate(years, "")).toBeNull();
  });
});

describe("asientos manuales en un ejercicio con libros legalizados", () => {
  it("la pantalla recibe los ejercicios legalizados con sus fechas", async () => {
    expect(await listLegalizedYears(COMPANY)).toEqual([
      { fiscalYearId: "fy-legal", code: "2020", from: "2020-01-01", to: "2020-12-31", submittedAt: "2021-04-20", registryName: "Registro Mercantil de Madrid" },
    ]);
    expect((await getFiscalYearLifecycle(COMPANY, "fy-legal"))?.legalizedBooks).toEqual({ submittedAt: "2021-04-20", registryName: "Registro Mercantil de Madrid" });
    expect((await getFiscalYearLifecycle(COMPANY, "fy-2021"))?.legalizedBooks).toBeNull();
  });

  it("crear sin confirmar se rechaza con el aviso y no consume número", async () => {
    await expect(createJournalEntry(COMPANY, "tenant-1", "user-1", { postedAt: utc(2020, 5, 1), reference: "Ajuste", lines: lines("5.00") }))
      .rejects.toMatchObject({ status: 409, code: "LEGALIZED_BOOKS_CONFIRMATION", message: expect.stringContaining("se presentaron a legalizar el 20/04/2021") });
    const [year] = await state.db.select({ next: fiscalYear.nextJournalEntryNumber }).from(fiscalYear).where(eq(fiscalYear.id, "fy-legal"));
    expect(year.next).toBe(2);
  });

  it("crear con confirmación funciona y lo deja en la auditoría", async () => {
    const created = await createJournalEntry(COMPANY, "tenant-1", "user-1", { postedAt: utc(2020, 5, 1), reference: "Ajuste", lines: lines("5.00"), acknowledgeLegalizedBooks: true });
    expect(created.number).toBe("AS-2020/000002");
    const audit = await lastAudit("accounting.entry.create");
    expect(audit.legalizedBooksConfirmed).toEqual([expect.objectContaining({ fiscalYearId: "fy-legal", yearCode: "2020", submissionId: "sub-1" })]);
    expect(audit).not.toHaveProperty("acknowledgeLegalizedBooks");
  });

  it("editar exige la misma confirmación", async () => {
    const payload = { postedAt: utc(2020, 4, 11), reference: "Corregido", lines: lines("12.00") };
    await expect(updateJournalEntry(COMPANY, "tenant-1", "user-1", "legal-1", payload)).rejects.toMatchObject({ status: 409, code: "LEGALIZED_BOOKS_CONFIRMATION" });
    const updated = await updateJournalEntry(COMPANY, "tenant-1", "user-1", "legal-1", { ...payload, acknowledgeLegalizedBooks: true });
    expect(updated?.reference).toBe("Corregido");
    expect((await lastAudit("accounting.entry.update")).legalizedBooksConfirmed).toHaveLength(1);
  });

  it("revertir un asiento de un ejercicio legalizado exige confirmación; el contraasiento va al ejercicio en curso", async () => {
    await expect(deleteJournalEntry(COMPANY, "tenant-1", "user-1", "legal-1")).rejects.toMatchObject({ status: 409, code: "LEGALIZED_BOOKS_CONFIRMATION" });
    const [untouched] = await state.db.select({ reversedAt: journalEntry.reversedAt }).from(journalEntry).where(eq(journalEntry.id, "legal-1"));
    expect(untouched.reversedAt).toBeNull();

    expect(await deleteJournalEntry(COMPANY, "tenant-1", "user-1", "legal-1", { acknowledgeLegalizedBooks: true })).toBe(true);
    const [reversal] = await state.db.select({ fiscalYearId: journalEntry.fiscalYearId }).from(journalEntry).where(eq(journalEntry.reversesEntryId, "legal-1"));
    expect(reversal.fiscalYearId).toBe("fy-now");
    expect((await lastAudit("accounting.entry.reverse")).legalizedBooksConfirmed).toEqual([expect.objectContaining({ fiscalYearId: "fy-legal" })]);
  });

  it("en un ejercicio sin libros presentados no se pide nada", async () => {
    const created = await createJournalEntry(COMPANY, "tenant-1", "user-1", { postedAt: utc(new Date().getUTCFullYear(), 0, 15), reference: "Normal", lines: lines("3.00") });
    expect(created.id).toBeTruthy();
    expect(await lastAudit("accounting.entry.create")).not.toHaveProperty("legalizedBooksConfirmed");
  });

  it("reabrir un ejercicio legalizado exige confirmación y deshace todo si falta", async () => {
    await state.db.update(fiscalYear).set({ isClosed: true, closedAt: new Date() }).where(eq(fiscalYear.id, "fy-legal"));
    await expect(reopenFiscalYear({ ...actor, fiscalYearId: "fy-legal", reason: "Factura olvidada" })).rejects.toMatchObject({ status: 409, code: "LEGALIZED_BOOKS_CONFIRMATION" });
    const [still] = await state.db.select({ isClosed: fiscalYear.isClosed }).from(fiscalYear).where(eq(fiscalYear.id, "fy-legal"));
    expect(still.isClosed).toBe(true);

    const result = await reopenFiscalYear({ ...actor, fiscalYearId: "fy-legal", reason: "Factura olvidada", acknowledgeLegalizedBooks: true });
    expect(result.legalizedBooks).toMatchObject({ submittedAt: "2021-04-20" });
    expect(await lastAudit("accounting.fiscalYear.reopen")).toMatchObject({ legalizedBooksSubmittedAt: "2021-04-20", legalizedBooksConfirmed: true });
  });
});

describe("plan de renumeración (función pura)", () => {
  const entry = (id: string, number: string, postedAt: Date, sourceType: string | null = null) => ({ id, number, postedAt, sourceType, reference: null });

  it("ordena por día local, con apertura primero y regularización y cierre al final", () => {
    const plan = planEntryRenumbering([
      entry("venta-enero", "AS-2026/000001", utc(2026, 0, 1)),
      entry("apertura", "AS-2026/000002", utc(2026, 0, 1), "fiscalYearOpening"),
      entry("cierre", "AS-2026/000003", utc(2026, 11, 31, 22, 59, 59), "fiscalYearClosing"),
      entry("regularizacion", "AS-2026/000004", utc(2026, 11, 31, 22, 59, 58), "fiscalYearRegularization"),
      entry("venta-diciembre", "AS-2026/000005", utc(2026, 11, 31)),
      entry("venta-marzo", "AS-2026/000006", utc(2026, 2, 3)),
    ], "2026", "Europe/Madrid");
    expect(plan.total).toBe(6);
    expect(plan.nextNumber).toBe(7);
    expect(Object.fromEntries(plan.changes.map((change) => [change.id, change.to]))).toEqual({
      apertura: "AS-2026/000001",
      "venta-enero": "AS-2026/000002",
      "venta-marzo": "AS-2026/000003",
      "venta-diciembre": "AS-2026/000004",
      regularizacion: "AS-2026/000005",
      cierre: "AS-2026/000006",
    });
  });

  it("sin cambios cuando ya está en orden, y cierra los huecos de numeración", () => {
    expect(planEntryRenumbering([entry("a", "AS-2026/000001", utc(2026, 0, 2)), entry("b", "AS-2026/000002", utc(2026, 0, 3))], "2026", "Europe/Madrid").changes).toEqual([]);
    const gaps = planEntryRenumbering([entry("a", "AS-2026/000001", utc(2026, 0, 2)), entry("b", "AS-2026/000007", utc(2026, 0, 3))], "2026", "Europe/Madrid");
    expect(gaps.changes).toEqual([{ id: "b", day: "2026-01-03", reference: null, from: "AS-2026/000007", to: "AS-2026/000002" }]);
    expect(gaps.nextNumber).toBe(3);
  });

  it("un ticket de las 00:30 de Madrid va con su día local, detrás de los del día anterior", () => {
    const plan = planEntryRenumbering([
      entry("ticket-dia-2", "AS-2026/000001", utc(2026, 0, 1, 23, 30)),
      entry("formulario-dia-1", "AS-2026/000002", utc(2026, 0, 1)),
      entry("formulario-dia-2", "AS-2026/000003", utc(2026, 0, 2)),
    ], "2026", "Europe/Madrid");
    expect(plan.changes.map((change) => `${change.id}:${change.day}:${change.to}`)).toEqual([
      "formulario-dia-1:2026-01-01:AS-2026/000001",
      "ticket-dia-2:2026-01-02:AS-2026/000002",
    ]);
  });
});

describe("renumeración de asientos del ejercicio", () => {
  beforeAll(async () => {
    // Numerados en el orden en que se registraron, no por fecha; con un número antiguo y un hueco.
    await addEntry("r-marzo", "AS-2021/000001", utc(2021, 2, 10), "fy-2021");
    await addEntry("r-enero", "AS-2021/000002", utc(2021, 0, 20), "fy-2021");
    await addEntry("r-apertura", "AS-2021/000003", utc(2021, 0, 1), "fy-2021", { sourceType: "fiscalYearOpening", sourceId: "fy-2021", isAutomatic: true });
    await addEntry("r-antiguo", "AS000042", utc(2021, 1, 5), "fy-2021");
    await addEntry("r-junio", "AS-2021/000008", utc(2021, 5, 1), "fy-2021");
  });

  it("la vista previa cuenta los cambios sin tocar nada", async () => {
    const before = await numbersOf("fy-2021");
    const preview = await previewEntryRenumbering(COMPANY, "fy-2021");
    expect(preview).toMatchObject({ yearCode: "2021", total: 5, changes: 4, blockedReason: null });
    expect(preview.sample[0]).toMatchObject({ id: "r-apertura", from: "AS-2021/000003", to: "AS-2021/000001" });
    expect(await numbersOf("fy-2021")).toEqual(before);
  });

  it("renumera en orden cronológico, actualiza el contador y audita el mapa", async () => {
    const result = await renumberFiscalYearEntries({ ...actor, fiscalYearId: "fy-2021" });
    expect(result).toMatchObject({ total: 5, changed: 4, nextNumber: 6 });
    expect(await numbersOf("fy-2021")).toEqual([
      "AS-2021/000001=r-apertura",
      "AS-2021/000002=r-enero",
      "AS-2021/000003=r-antiguo",
      "AS-2021/000004=r-marzo",
      "AS-2021/000005=r-junio",
    ]);
    const [year] = await state.db.select({ next: fiscalYear.nextJournalEntryNumber }).from(fiscalYear).where(eq(fiscalYear.id, "fy-2021"));
    expect(year.next).toBe(6);
    const audit = await lastAudit("accounting.entries.renumber");
    expect(audit).toMatchObject({ code: "2021", total: 5, changed: 4 });
    expect(audit.map).toContainEqual({ id: "r-antiguo", from: "AS000042", to: "AS-2021/000003" });

    // El siguiente asiento sigue la numeración sin huecos ni choques.
    const created = await createJournalEntry(COMPANY, "tenant-1", "user-1", { postedAt: utc(2021, 6, 1), reference: "Julio", lines: lines("1.00") });
    expect(created.number).toBe("AS-2021/000006");
  });

  it("repetirla no cambia nada", async () => {
    expect(await previewEntryRenumbering(COMPANY, "fy-2021")).toMatchObject({ total: 6, changes: 0 });
    expect(await renumberFiscalYearEntries({ ...actor, fiscalYearId: "fy-2021" })).toMatchObject({ changed: 0, nextNumber: 7 });
  });

  it("no se renumera si el número nuevo lo tiene un asiento de fuera del ejercicio (y no cambia nada)", async () => {
    await addEntry("r-tarde", "AS-2021/000050", utc(2021, 0, 2), "fy-2021");
    await addEntry("intruso", "AS-2021/000007", utc(2022, 0, 2), null);
    const before = await numbersOf("fy-2021");
    await expect(renumberFiscalYearEntries({ ...actor, fiscalYearId: "fy-2021" })).rejects.toMatchObject({ status: 409, code: "RENUMBER_NUMBER_TAKEN" });
    expect(await numbersOf("fy-2021")).toEqual(before);
    await state.db.delete(journalEntry).where(eq(journalEntry.id, "intruso"));
    expect(await renumberFiscalYearEntries({ ...actor, fiscalYearId: "fy-2021" })).toMatchObject({ total: 7, nextNumber: 8 });
    expect((await numbersOf("fy-2021"))[1]).toBe("AS-2021/000002=r-tarde");
  });

  it("no se permite en ejercicios cerrados ni con libros presentados a legalizar", async () => {
    expect((await previewEntryRenumbering(COMPANY, "fy-2022")).blockedReason).toContain("está cerrado");
    await expect(renumberFiscalYearEntries({ ...actor, fiscalYearId: "fy-2022" })).rejects.toMatchObject({ status: 409, code: "RENUMBER_NOT_ALLOWED" });
    expect((await previewEntryRenumbering(COMPANY, "fy-legal")).blockedReason).toContain("presentados a legalizar");
    await expect(renumberFiscalYearEntries({ ...actor, fiscalYearId: "fy-legal" })).rejects.toMatchObject({ status: 409, code: "RENUMBER_NOT_ALLOWED" });
    await expect(renumberFiscalYearEntries({ ...actor, fiscalYearId: "no-existe" })).rejects.toMatchObject({ status: 404 });
  });
});
