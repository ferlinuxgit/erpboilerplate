import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Límites en hora local de los listados contables, contra Postgres real (PGlite en memoria): un
 * ticket del 1 de enero a las 00:30 de Madrid (31-12 23:30 UTC) está numerado en el ejercicio nuevo
 * y debe salir en enero en el diario, el mayor, el plan contable, la lista previa al cierre y la
 * reclasificación.
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
import { accountChart, company, fiscalYear, journal, journalEntry, journalLine, tenant, user } from "@/db/schema";
import { parseListParams } from "@/lib/list-params";
import { loadPrefixTotals } from "@/server/accounting/chart-tree";
import { getCloseChecklist } from "@/server/accounting/close-checklist";
import { journalEntryListConfig, listJournalEntriesForExport, listJournalEntriesPage } from "@/server/accounting/journal-entry-list";
import { reclassifyCompany } from "@/server/accounting/reclassify";
import { getLedgerBalanceBefore, getLedgerByAccount, listAccounts } from "@/server/accounting/service";

const COMPANY = "company-1";
const utc = (...parts: [number, number, number, number?, number?, number?]) => new Date(Date.UTC(...parts));

type Line = [accountId: string, debit: string, credit: string];

async function addEntry(id: string, number: string, postedAt: Date, lines: Line[], extra: Partial<typeof journalEntry.$inferInsert> = {}) {
  await state.db.insert(journalEntry).values({ id, companyId: COMPANY, number, journalId: "j1", postedAt, reference: `Ref ${number}`, ...extra });
  await state.db.insert(journalLine).values(lines.map(([accountId, debit, credit], index) => ({ journalEntryId: id, accountId, debit, credit, lineNumber: index + 1 })));
}

const listParams = (query: Record<string, string>) => parseListParams(query, journalEntryListConfig);

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);

  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Ejemplo", legalName: "Ejemplo, S.L.", vatNumber: "B12345678", countryCode: "ES", postalCode: "28001", city: "Madrid" });
  await state.db.insert(fiscalYear).values([
    { id: "fy-2026", companyId: COMPANY, code: "2026", startsAt: utc(2026, 0, 1), endsAt: utc(2026, 11, 31) },
    { id: "fy-2027", companyId: COMPANY, code: "2027", startsAt: utc(2027, 0, 1), endsAt: utc(2027, 11, 31) },
  ]);
  await state.db.insert(journal).values({ id: "j1", companyId: COMPANY, code: "GEN", name: "General" });
  await state.db.insert(accountChart).values([
    { id: "a555", companyId: COMPANY, code: "55500000", name: "Partidas pendientes de aplicación", type: "ASSET" },
    { id: "a570", companyId: COMPANY, code: "57000000", name: "Caja", type: "ASSET" },
    { id: "a700", companyId: COMPANY, code: "70000000", name: "Ventas", type: "REVENUE" },
  ]);

  // Venta del 31 de diciembre a las 23:30 de Madrid (22:30 UTC): ejercicio 2026.
  await addEntry("e-dec", "AS-2026/000001", utc(2026, 11, 31, 22, 30), [["a570", "100.00", "0"], ["a700", "0", "100.00"]], { fiscalYearId: "fy-2026" });
  // Ticket del 1 de enero a las 00:30 de Madrid (31-12 23:30 UTC): ejercicio 2027.
  await addEntry("e-jan", "AS-2027/000001", utc(2026, 11, 31, 23, 30), [["a570", "40.00", "0"], ["a555", "0", "40.00"]], { fiscalYearId: "fy-2027" });
  // Asiento de formulario del 1 de enero (00:00 UTC).
  await addEntry("e-form", "AS-2027/000002", utc(2027, 0, 1), [["a570", "7.00", "0"], ["a700", "0", "7.00"]], { fiscalYearId: "fy-2027" });
});

describe("diario filtrado por fechas", () => {
  it("el ticket de las 00:30 del 1 de enero sale en enero, no en diciembre", async () => {
    const december = await listJournalEntriesPage(COMPANY, listParams({ from: "2026-12-01", to: "2026-12-31" }));
    expect(december.rows.map((row) => row.number)).toEqual(["AS-2026/000001"]);

    const january = await listJournalEntriesPage(COMPANY, listParams({ from: "2027-01-01", to: "2027-01-31" }));
    expect(january.rows.map((row) => row.number).sort()).toEqual(["AS-2027/000001", "AS-2027/000002"]);
    expect(january.totals).toMatchObject({ debit: 47, credit: 47 });
  });

  it("con una sola fecha y en la exportación se aplica el mismo límite", async () => {
    const from = await listJournalEntriesForExport(COMPANY, listParams({ from: "2027-01-01" }));
    expect(from.map((row) => row.number).sort()).toEqual(["AS-2027/000001", "AS-2027/000002"]);
    const to = await listJournalEntriesForExport(COMPANY, listParams({ to: "2026-12-31" }));
    expect(to.map((row) => row.number)).toEqual(["AS-2026/000001"]);
    expect(await listJournalEntriesForExport(COMPANY, listParams({}))).toHaveLength(3);
  });
});

describe("mayor y plan contable por periodo", () => {
  it("el mayor de caja de 2027 incluye el ticket y su saldo anterior es solo lo de 2026", async () => {
    const rows = await getLedgerByAccount(COMPANY, "a570", { from: utc(2027, 0, 1), toExclusive: utc(2028, 0, 1) });
    expect(rows.map((row) => row.number).sort()).toEqual(["AS-2027/000001", "AS-2027/000002"]);
    expect(await getLedgerBalanceBefore(COMPANY, "a570", utc(2027, 0, 1))).toBe(100);

    const previous = await getLedgerByAccount(COMPANY, "a570", { from: utc(2026, 0, 1), toExclusive: utc(2027, 0, 1) });
    expect(previous.map((row) => row.number)).toEqual(["AS-2026/000001"]);
    expect(await getLedgerByAccount(COMPANY, "a570")).toHaveLength(3);
  });

  it("las sumas del plan contable reparten igual que la numeración", async () => {
    const year2026 = await listAccounts(COMPANY, { from: utc(2026, 0, 1), toExclusive: utc(2027, 0, 1) });
    expect(year2026.find((row) => row.id === "a570")).toMatchObject({ debit: 100, opening: 0 });
    expect(year2026.find((row) => row.id === "a555")).toMatchObject({ credit: 0, entries: 0 });

    const year2027 = await listAccounts(COMPANY, { from: utc(2027, 0, 1), toExclusive: utc(2028, 0, 1) });
    expect(year2027.find((row) => row.id === "a570")).toMatchObject({ debit: 47, opening: 100 });

    const prefixes = await loadPrefixTotals(COMPANY, [3], { from: utc(2027, 0, 1), toExclusive: utc(2028, 0, 1) });
    expect(prefixes.get("570")).toMatchObject({ openingCents: 10000, debitCents: 4700 });
    expect(prefixes.get("555")).toMatchObject({ openingCents: 0, creditCents: 4000 });
  });
});

describe("lista previa al cierre", () => {
  it("la 555 del ticket de enero no cuenta en el cierre de 2026", async () => {
    const checklist = await getCloseChecklist(COMPANY, "fy-2026");
    expect(checklist.items.find((item) => item.id === "bank-555")).toMatchObject({ status: "ok" });
    const next = await getCloseChecklist(COMPANY, "fy-2027");
    expect(next.items.find((item) => item.id === "bank-555")?.status).not.toBe("ok");
  });
});

describe("reclasificación", () => {
  it("asigna el ejercicio por el día local del asiento", async () => {
    await state.db.update(journalEntry).set({ fiscalYearId: null }).where(eq(journalEntry.companyId, COMPANY));
    await state.db.transaction((tx: never) => reclassifyCompany(tx, COMPANY, { apply: true, actorUserId: "user-1" }));
    const rows = await state.db.select({ id: journalEntry.id, fiscalYearId: journalEntry.fiscalYearId }).from(journalEntry).where(eq(journalEntry.companyId, COMPANY));
    expect(Object.fromEntries(rows.map((row: { id: string; fiscalYearId: string | null }) => [row.id, row.fiscalYearId]))).toEqual({
      "e-dec": "fy-2026",
      "e-jan": "fy-2027",
      "e-form": "fy-2027",
    });
  });
});
