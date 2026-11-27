import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Inmovilizado contra Postgres real (PGlite en memoria): dotación con el 303 presentado, centro de
 * coste en el apunte de gasto y venta de un bien enlazada a su factura de venta. Los asientos se
 * escriben de verdad (un `createAutomaticEntry` mínimo) para comprobar que cuadran con la factura.
 */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
  entries: 0,
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/server/accounting/auto-post", () => ({
  // Asiento mínimo: cabecera y líneas tal como llegan (sin subcuentas ni numeración por ejercicio).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createAutomaticEntry: vi.fn(async (input: any) => {
    const { journalEntry, journalLine } = await import("@/db/schema");
    state.entries += 1;
    const id = `entry-${state.entries}`;
    const number = `AS-${state.entries}`;
    await input.dbClient.insert(journalEntry).values({
      id,
      companyId: input.companyId,
      number,
      journalId: "journal-1",
      postedAt: input.postedAt,
      reference: input.reference,
      sourceType: input.sourceType ?? input.entityName,
      sourceId: input.sourceId ?? input.entityId,
      isAutomatic: true,
    });
    await input.dbClient.insert(journalLine).values(
      input.lines
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((line: any) => Number(line.debit) !== 0 || Number(line.credit) !== 0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((line: any, index: number) => ({
          journalEntryId: id,
          lineNumber: index + 1,
          accountId: line.accountId,
          debit: String(line.debit),
          credit: String(line.credit),
          concept: line.concept ?? null,
          documentType: line.documentType ?? null,
          documentId: line.documentId ?? null,
        })),
    );
    return { id, number };
  }),
  reverseAutomaticEntries: vi.fn(async () => 1),
}));
vi.mock("@/server/accounting/subaccounts", () => ({
  // Las cuentas de la prueba ya son subcuentas: se buscan por su código de 3 o 4 dígitos.
  ensureSubaccount: vi.fn(async (_companyId: string, code: string) => ({ id: `acc-${code}` })),
  toPostableAccountId: vi.fn(async (_companyId: string, accountId: string) => accountId),
}));

import * as schema from "@/db/schema";
import { accountChart, company, costCenter, customer, fiscalReport, fiscalYear, fixedAsset, invoice, journal, journalEntry, journalLine, tenant, user } from "@/db/schema";
import { disposeFixedAsset, getFixedAsset, postDepreciation, previewDepreciation } from "@/server/fixed-assets/service";

const COMPANY = "company-1";
const actor = { tenantId: "tenant-1", companyId: COMPANY, actorUserId: "user-1" };

const ACCOUNTS: Array<[string, "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE"]> = [
  ["217", "ASSET"],
  ["2817", "ASSET"],
  ["430", "ASSET"],
  ["477", "LIABILITY"],
  ["681", "EXPENSE"],
  ["671", "EXPENSE"],
  ["700", "REVENUE"],
  ["771", "REVENUE"],
];

async function asset(id: string, code: string, extra: Partial<typeof fixedAsset.$inferInsert> = {}) {
  await state.db.insert(fixedAsset).values({
    id,
    companyId: COMPANY,
    code,
    description: `Máquina ${code}`,
    assetAccountId: "acc-217",
    accumulatedAccountId: "acc-2817",
    expenseAccountId: "acc-681",
    acquisitionDate: "2025-01-01",
    inServiceDate: "2025-01-01",
    acquisitionCost: "3000.00",
    method: "percent",
    annualPct: "25",
    ...extra,
  });
}

async function linesOf(entryId: string) {
  const rows = await state.db
    .select({ code: accountChart.code, debit: journalLine.debit, credit: journalLine.credit, costCenterId: journalLine.costCenterId })
    .from(journalLine)
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(eq(journalLine.journalEntryId, entryId));
  return (rows as Array<{ code: string; debit: string; credit: string; costCenterId: string | null }>).map((row) => ({ ...row, debit: Number(row.debit), credit: Number(row.credit) }));
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Empresa", legalName: "Empresa SL", vatNumber: "B12345678" });
  await state.db.insert(journal).values({ id: "journal-1", companyId: COMPANY, code: "GEN", name: "General" });
  await state.db.insert(fiscalYear).values([
    { id: "fy-2025", companyId: COMPANY, code: "2025", startsAt: new Date("2025-01-01T00:00:00Z"), endsAt: new Date("2025-12-31T00:00:00Z") },
    { id: "fy-2026", companyId: COMPANY, code: "2026", startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: new Date("2026-12-31T00:00:00Z") },
  ]);
  await state.db.insert(accountChart).values(ACCOUNTS.map(([code, type]) => ({ id: `acc-${code}`, companyId: COMPANY, code, name: `Cuenta ${code}`, type })));
  await state.db.insert(costCenter).values({ id: "cc-1", companyId: COMPANY, code: "TALLER", name: "Taller" });
  // 303 del 4T de 2025 ya presentado.
  await state.db.insert(fiscalReport).values({ id: "fr-303", companyId: COMPANY, code: "303", period: "2025-Q4", status: "FILED", filedAt: new Date("2026-01-20T10:00:00Z") });
  await asset("asset-1", "BI-0001", { costCenterId: "cc-1" });
}, 60_000);

afterAll(async () => {
  await state.client?.close();
});

describe("dotación a la amortización", () => {
  it("la del 31/12 se contabiliza aunque el 303 del 4T esté presentado, con el centro de coste del bien en el gasto", async () => {
    const preview = await previewDepreciation(COMPANY, { until: "2025-12-31" });
    expect(preview).toMatchObject({ entries: 1, amountCents: 75_000, blockedCents: 0 });

    const run = await postDepreciation(actor, { until: "2025-12-31" });
    expect(run).toMatchObject({ entries: 1, amountCents: 75_000, blockedCents: 0 });
    const [entry] = await state.db.select().from(journalEntry).where(and(eq(journalEntry.companyId, COMPANY), eq(journalEntry.sourceType, "fixedAssetDepreciation")));
    expect(await linesOf(entry.id)).toEqual([
      { code: "681", debit: 750, credit: 0, costCenterId: "cc-1" },
      { code: "2817", debit: 0, credit: 750, costCenterId: null },
    ]);
  });

  it("un 130 presentado sí la bloquea (la amortización cambia su rendimiento)", async () => {
    await asset("asset-130", "BI-0130");
    await state.db.insert(fiscalReport).values({ id: "fr-130", companyId: COMPANY, code: "130", period: "2025-Q4", status: "FILED", filedAt: new Date("2026-01-20T10:00:00Z") });
    const preview = await previewDepreciation(COMPANY, { until: "2025-12-31", assetId: "asset-130" });
    expect(preview).toMatchObject({ entries: 0, blockedCents: 75_000 });
    expect(preview.rows[0].blockedReason).toMatch(/modelo 130/);
    await state.db.delete(fiscalReport).where(eq(fiscalReport.id, "fr-130"));
    await state.db.delete(fixedAsset).where(eq(fixedAsset.id, "asset-130"));
  });
});

describe("venta de un bien con factura de venta emitida", () => {
  it("la baja salda el ingreso de la factura: el cobro y el IVA quedan en la factura y el resultado en 671/771", async () => {
    await state.db.insert(customer).values({ id: "customer-1", companyId: COMPANY, name: "Comprador SL" });
    await state.db.insert(invoice).values({ id: "inv-1", companyId: COMPANY, customerId: "customer-1", number: "FA-2026/000001", issueDate: new Date("2026-06-30T10:00:00Z"), issuedAt: new Date("2026-06-30T10:00:00Z"), totalAmount: "1210.00", status: "SENT" });
    // Asiento de la factura: 430 (1.210) a 700 (1.000) y 477 (210).
    await state.db.insert(journalEntry).values({ id: "entry-invoice", companyId: COMPANY, number: "AS-INV", journalId: "journal-1", postedAt: new Date("2026-06-30T10:00:00Z"), sourceType: "invoice", sourceId: "inv-1", isAutomatic: true });
    await state.db.insert(journalLine).values([
      { journalEntryId: "entry-invoice", accountId: "acc-430", debit: "1210.00", credit: "0" },
      { journalEntryId: "entry-invoice", accountId: "acc-700", debit: "0", credit: "1000.00" },
      { journalEntryId: "entry-invoice", accountId: "acc-477", debit: "0", credit: "210.00" },
    ]);

    const result = await disposeFixedAsset(actor, "asset-1", { type: "sale", date: "2026-06-30", salesInvoiceId: "inv-1" });
    // Coste 3.000; amortizado 750 (2025) + 371,92 (181 días de 2026 al 25 %) = 1.121,92; valor neto 1.878,08.
    const lines = await linesOf(result.entryId);
    const byCode = Object.fromEntries(lines.map((line) => [line.code, line.debit - line.credit]));
    expect(byCode["700"]).toBe(1000);
    expect(byCode["217"]).toBe(-3000);
    expect(lines.reduce((sum, line) => sum + Math.round((line.debit - line.credit) * 100), 0)).toBe(0);
    expect(result.resultCents).toBe(Math.round((1000 - (3000 - byCode["2817"])) * 100));
    expect(result.resultCents).toBeLessThan(0);
    expect(byCode["671"]).toBe(-result.resultCents / 100);
    // Sin cuenta de banco ni IVA en la baja: los lleva la factura.
    expect(byCode["430"]).toBeUndefined();
    expect(byCode["477"]).toBeUndefined();

    // Ingreso 700 de la factura + baja = 0: la venta de inmovilizado no queda como cifra de negocios.
    const [revenue] = await state.db
      .select({ debit: journalLine.debit, credit: journalLine.credit })
      .from(journalLine)
      .where(and(eq(journalLine.accountId, "acc-700"), eq(journalLine.journalEntryId, result.entryId)));
    expect(Number(revenue.debit)).toBe(1000);

    const detail = await getFixedAsset(COMPANY, "asset-1");
    expect(detail?.asset).toMatchObject({ status: "disposed", disposalInvoiceId: "inv-1", disposalProceeds: "1000.00", disposalAccountId: null });
    expect(detail?.disposalInvoice).toMatchObject({ id: "inv-1", number: "FA-2026/000001" });
    expect(detail?.costCenter).toMatchObject({ code: "TALLER" });
  });

  it("no deja usar dos veces el ingreso de la misma factura ni una factura sin emitir", async () => {
    await asset("asset-2", "BI-0002", { acquisitionDate: "2026-01-01", inServiceDate: "2026-01-01", isDepreciable: false, accumulatedAccountId: null, expenseAccountId: null, annualPct: null });
    await expect(disposeFixedAsset(actor, "asset-2", { type: "sale", date: "2026-06-30", salesInvoiceId: "inv-1" })).rejects.toMatchObject({ code: "FIXED_ASSET_INVALID", message: expect.stringMatching(/ingreso contabilizado disponible/) });
    await expect(disposeFixedAsset(actor, "asset-2", { type: "sale", date: "2026-06-30", salesInvoiceId: "missing" })).rejects.toMatchObject({ code: "FIXED_ASSET_INVALID", message: expect.stringMatching(/no está emitida/) });
    // Sin factura sigue exigiendo cuenta de contrapartida.
    await expect(disposeFixedAsset(actor, "asset-2", { type: "sale", date: "2026-06-30", proceeds: 100 })).rejects.toMatchObject({ code: "FIXED_ASSET_INVALID" });
  });
});
