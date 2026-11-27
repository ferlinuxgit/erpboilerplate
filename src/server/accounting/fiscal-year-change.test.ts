import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Cambio de ejercicio en hora local contra Postgres real (PGlite en memoria): el ejercicio, la
 * serie, el número de asiento y los estados financieros de un ticket emitido el 1 de enero a las
 * 00:30 de Madrid (31-12 23:30 UTC) son los del ejercicio nuevo, y las fechas de formulario
 * (00:00 UTC) no se mueven.
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
import { accountChart, company, documentSeries, fiscalYear, journal, journalEntry, journalLine, tenant, user } from "@/db/schema";
import { reserveJournalEntryNumber } from "@/server/accounting/numbers";
import { loadStatementAccountRows } from "@/server/accounting/statements";
import { findFiscalYearForDate, reserveSeriesNumberDetailed } from "@/server/documents/series";
import { assertFiscalYearOpen } from "@/server/fiscal/locks";

const MADRID = "company-madrid";
const CANARY = "company-canary";
const utc = (...parts: [number, number, number, number?, number?, number?]) => new Date(Date.UTC(...parts));
/** 1 de enero de 2027 a las 00:30 de Madrid; en Canarias, 31 de diciembre a las 23:30. */
const NEW_YEAR_TICKET = utc(2026, 11, 31, 23, 30);

async function seedCompany(id: string, postalCode: string) {
  await state.db.insert(company).values({ id, tenantId: "tenant-1", name: id, legalName: id, vatNumber: "B12345678", countryCode: "ES", postalCode });
  await state.db.insert(fiscalYear).values([
    { id: `${id}-2026`, companyId: id, code: "2026", startsAt: utc(2026, 0, 1), endsAt: utc(2026, 11, 31), isClosed: true },
    { id: `${id}-2027`, companyId: id, code: "2027", startsAt: utc(2027, 0, 1), endsAt: utc(2027, 11, 31) },
  ]);
  await state.db.insert(documentSeries).values([
    { companyId: id, fiscalYearId: `${id}-2026`, type: "SALES_INVOICE", prefix: "FA26-", nextNumber: 7 },
    { companyId: id, fiscalYearId: `${id}-2027`, type: "SALES_INVOICE", prefix: "FA27-", nextNumber: 1 },
  ]);
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await seedCompany(MADRID, "28001");
  await seedCompany(CANARY, "35001");
}, 120_000);

afterAll(async () => {
  await state.client?.close();
});

describe("ejercicio de una fecha", () => {
  it("el ticket de las 00:30 del 1 de enero (Madrid) es del ejercicio nuevo", async () => {
    expect((await findFiscalYearForDate(state.db, MADRID, NEW_YEAR_TICKET))?.code).toBe("2027");
    // 2026 está cerrado: si se resolviera en UTC, esto lanzaría «ejercicio cerrado».
    await expect(assertFiscalYearOpen(MADRID, NEW_YEAR_TICKET, state.db)).resolves.toBeUndefined();
  });

  it("en Canarias ese mismo instante todavía es 31 de diciembre", async () => {
    expect((await findFiscalYearForDate(state.db, CANARY, NEW_YEAR_TICKET))?.code).toBe("2026");
    await expect(assertFiscalYearOpen(CANARY, NEW_YEAR_TICKET, state.db)).rejects.toMatchObject({ code: "FISCAL_YEAR_CLOSED" });
  });

  it("las 23:30 de Madrid del 31 de diciembre siguen en el ejercicio viejo", async () => {
    expect((await findFiscalYearForDate(state.db, MADRID, utc(2026, 11, 31, 22, 30)))?.code).toBe("2026");
  });

  it("las fechas de formulario no se mueven", async () => {
    expect((await findFiscalYearForDate(state.db, MADRID, utc(2026, 11, 31)))?.code).toBe("2026");
    expect((await findFiscalYearForDate(state.db, MADRID, utc(2027, 0, 1)))?.code).toBe("2027");
    expect((await findFiscalYearForDate(state.db, MADRID, utc(2026, 0, 1)))?.code).toBe("2026");
    expect(await findFiscalYearForDate(state.db, MADRID, utc(2025, 11, 31))).toBeNull();
  });
});

describe("serie y número de asiento", () => {
  it("la factura se numera en la serie del ejercicio nuevo", async () => {
    const reserved = await reserveSeriesNumberDetailed(state.db, { companyId: MADRID, type: "SALES_INVOICE", referenceDate: NEW_YEAR_TICKET });
    const [series] = await state.db.select().from(documentSeries).where(eq(documentSeries.id, reserved.seriesId));
    expect(series.fiscalYearId).toBe(`${MADRID}-2027`);
  });

  it("el asiento se numera en el ejercicio nuevo; el de una fecha de formulario del 31, en el viejo", async () => {
    expect(await reserveJournalEntryNumber(state.db, MADRID, NEW_YEAR_TICKET)).toEqual({ number: "AS-2027/000001", fiscalYearId: `${MADRID}-2027` });
    expect(await reserveJournalEntryNumber(state.db, MADRID, utc(2026, 11, 31))).toEqual({ number: "AS-2026/000001", fiscalYearId: `${MADRID}-2026` });
    expect(await reserveJournalEntryNumber(state.db, CANARY, NEW_YEAR_TICKET)).toEqual({ number: "AS-2026/000001", fiscalYearId: `${CANARY}-2026` });
  });
});

describe("estados financieros", () => {
  it("el ticket cuenta en el ejercicio nuevo y la regularización antigua (23:59:58 UTC) sigue en el viejo", async () => {
    await state.db.insert(journal).values({ id: "j1", companyId: MADRID, code: "GEN", name: "General" });
    await state.db.insert(accountChart).values([
      { id: "a570", companyId: MADRID, code: "57000000", name: "Caja", type: "ASSET" },
      { id: "a700", companyId: MADRID, code: "70000000", name: "Ventas", type: "REVENUE" },
      { id: "a129", companyId: MADRID, code: "12900000", name: "Resultado", type: "EQUITY" },
    ]);
    const entries = [
      // Venta de 2026 (fecha de formulario del 31 de diciembre).
      { id: "e1", postedAt: utc(2026, 11, 31), sourceType: null, lines: [["a570", "100", "0"], ["a700", "0", "100"]] },
      // Regularización de 2026 generada antes del cambio: 23:59:58 UTC (ya día 1 en Madrid).
      { id: "e2", postedAt: utc(2026, 11, 31, 23, 59, 58), sourceType: "fiscalYearRegularization", lines: [["a700", "100", "0"], ["a129", "0", "100"]] },
      // Ticket del 1 de enero a las 00:30 de Madrid.
      { id: "e3", postedAt: NEW_YEAR_TICKET, sourceType: null, lines: [["a570", "30", "0"], ["a700", "0", "30"]] },
    ] as const;
    for (const entry of entries) {
      await state.db.insert(journalEntry).values({ id: entry.id, companyId: MADRID, number: entry.id, journalId: "j1", postedAt: entry.postedAt, sourceType: entry.sourceType, sourceId: entry.sourceType ? `${MADRID}-2026` : null });
      await state.db.insert(journalLine).values(entry.lines.map(([accountId, debit, credit]) => ({ journalEntryId: entry.id, accountId, debit, credit })));
    }

    const byCode = (rows: Awaited<ReturnType<typeof loadStatementAccountRows>>) => new Map(rows.map((row) => [row.code, row]));

    const y2026 = byCode(await loadStatementAccountRows(MADRID, { yearStart: utc(2026, 0, 1), from: utc(2026, 0, 1), toExclusive: utc(2027, 0, 1) }));
    expect(y2026.get("70000000")).toMatchObject({ priorCents: 0, debitCents: 0, creditCents: 10_000, yearToDateCents: -10_000 });
    expect(y2026.get("57000000")).toMatchObject({ debitCents: 10_000 });

    const y2027 = byCode(await loadStatementAccountRows(MADRID, { yearStart: utc(2027, 0, 1), from: utc(2027, 0, 1), toExclusive: utc(2028, 0, 1) }));
    // Ventas: 2026 queda regularizado en el saldo anterior (0) y el ticket es movimiento de 2027.
    expect(y2027.get("70000000")).toMatchObject({ priorCents: 0, debitCents: 0, creditCents: 3_000, yearToDateCents: -3_000 });
    expect(y2027.get("57000000")).toMatchObject({ priorCents: 10_000, debitCents: 3_000 });
    expect(y2027.get("12900000")).toMatchObject({ priorCents: -10_000 });
  });
});
