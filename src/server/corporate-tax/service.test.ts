import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Impuesto sobre Sociedades contra Postgres real (PGlite en memoria, esquema completo de Drizzle y
 * plan contable español): liquidación desde el libro, asiento del impuesto y su recálculo, pagos
 * fraccionados, bases negativas entre ejercicios y el punto del cierre.
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
import { accountChart, company, companySettings, fiscalYear, journalEntry, journalLine, tenant, user } from "@/db/schema";
import { getCloseChecklist } from "@/server/accounting/close-checklist";
import { createJournalEntry } from "@/server/accounting/service";
import { ensureSubaccount } from "@/server/accounting/subaccounts";
import type { CorporateTaxReturnInput } from "@/server/corporate-tax/schemas";
import {
  CORPORATE_TAX_SOURCE,
  defaultReturnInputs,
  getCorporateTaxCalendarData,
  getCorporateTaxYear,
  getInstallments,
  isCorporateTaxCompany,
  listLossRegister,
  markCorporateTaxReturnFiled,
  payInstallment,
  postCorporateTaxEntry,
  saveCorporateTaxReturn,
  saveInstallment,
  saveManualLoss,
  undoInstallmentPayment,
  unpostCorporateTaxEntry,
} from "@/server/corporate-tax/service";
import { applyEsSeeds } from "@/server/seeds/apply";

const TENANT = "tenant-1";
const USER = "user-1";
const COMPANY = "soc";
const FY25 = "soc-fy2025";
const FY26 = "soc-fy2026";
const actor = { tenantId: TENANT, companyId: COMPANY, actorUserId: USER };
const eur = (amount: number) => Math.round(amount * 100);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function entry(date: string, lines: Array<[code: string, debit: number, credit: number]>) {
  const prepared = [];
  for (const [code, debit, credit] of lines) {
    prepared.push({ accountId: (await ensureSubaccount(COMPANY, code)).id, debit: debit ? String(debit) : "", credit: credit ? String(credit) : "" });
  }
  return createJournalEntry(COMPANY, TENANT, USER, { postedAt: day(date), reference: "Apunte de prueba", lines: prepared });
}

/** Saldo (debe − haber) de las cuentas que empiezan por `prefix`, con todos los asientos. */
async function balance(prefix: string) {
  const rows = await state.db
    .select({ code: accountChart.code, debit: journalLine.debit, credit: journalLine.credit })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(eq(journalEntry.companyId, COMPANY));
  return rows
    .filter((row: { code: string }) => row.code.startsWith(prefix))
    .reduce((sum: number, row: { debit: string; credit: string }) => sum + eur(Number(row.debit)) - eur(Number(row.credit)), 0);
}

async function taxEntries() {
  return state.db
    .select({ id: journalEntry.id, reversedAt: journalEntry.reversedAt, reversesEntryId: journalEntry.reversesEntryId, postedAt: journalEntry.postedAt })
    .from(journalEntry)
    .where(and(eq(journalEntry.companyId, COMPANY), eq(journalEntry.sourceType, CORPORATE_TAX_SOURCE.taxEntry)))
    .orderBy(asc(journalEntry.number));
}

const inputs = (overrides: Partial<CorporateTaxReturnInput> = {}): CorporateTaxReturnInput => ({ ...defaultReturnInputs(), ...overrides });

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: USER, name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: TENANT, name: "T", slug: "t", ownerId: USER });
  await state.db.insert(company).values({ id: COMPANY, tenantId: TENANT, name: "Sociedad SL", countryCode: "ES" });
  await state.db.insert(companySettings).values({ companyId: COMPANY, subaccountLength: 8, businessType: "both" });
  await state.db.insert(fiscalYear).values([
    { id: FY25, companyId: COMPANY, code: "2025", startsAt: day("2025-01-01"), endsAt: day("2025-12-31") },
    { id: FY26, companyId: COMPANY, code: "2026", startsAt: day("2026-01-01"), endsAt: day("2026-12-31") },
  ]);
  await applyEsSeeds({ tenantId: TENANT, companyId: COMPANY, actorUserId: USER, activeFiscalYearId: FY25 });

  // 2025: ventas 100.000, compras 60.000, una multa de 1.000 y 500 de retenciones soportadas.
  await entry("2025-06-01", [["572", 100_000, 0], ["700", 0, 100_000]]);
  await entry("2025-06-15", [["600", 60_000, 0], ["572", 0, 60_000]]);
  await entry("2025-07-01", [["678", 1_000, 0], ["572", 0, 1_000]]);
  await entry("2025-09-01", [["473", 500, 0], ["572", 0, 500]]);
  // 2026: ventas 20.000 en febrero.
  await entry("2026-02-10", [["572", 20_000, 0], ["700", 0, 20_000]]);
}, 180_000);

afterAll(async () => {
  await state.client?.close();
});

describe("Impuesto sobre Sociedades (servicio)", () => {
  it("solo aplica a sociedades de un país con modelos de la AEAT", async () => {
    expect(await isCorporateTaxCompany(COMPANY, "ES")).toBe(true);
    expect(await isCorporateTaxCompany(COMPANY, "PT")).toBe(false);
    await state.db.update(companySettings).set({ taxpayerType: "individual" }).where(eq(companySettings.companyId, COMPANY));
    expect(await isCorporateTaxCompany(COMPANY, "ES")).toBe(false);
    expect(await getCorporateTaxCalendarData(COMPANY, "ES")).toBeNull();
    await state.db.update(companySettings).set({ taxpayerType: "company" }).where(eq(companySettings.companyId, COMPANY));
  });

  it("liquida desde el libro sin haber guardado nada y propone la multa de la 678", async () => {
    const view = await getCorporateTaxYear(COMPANY, FY25);
    expect(view.returnId).toBeNull();
    expect(view.facts.accountingResultBeforeTaxCents).toBe(eur(39_000));
    expect(view.facts.revenueCents).toBe(eur(100_000));
    expect(view.facts.ledgerPriorYearRevenueCents).toBeNull();
    expect(view.facts.account473Cents).toBe(eur(500));
    expect(view.inputs.regime).toBe("general");
    expect(view.result.grossQuotaCents).toBe(eur(9_750));
    expect(view.result.differentialCents).toBe(eur(9_250));
    expect(view.suggestions).toEqual([expect.objectContaining({ kind: "fines", amountCents: eur(1_000) })]);
    expect(view.window).toEqual({ from: "2026-07-01", to: "2026-07-25" });
    expect(view.entry.posted).toBeNull();
  });

  it("guarda los ajustes y el tipo: microempresa de 2025 al 21 %", async () => {
    const view = await saveCorporateTaxReturn(actor, FY25, inputs({
      regime: "micro",
      adjustments: [{ id: "a1", kind: "fines", concept: "Multas y sanciones (cuenta 678)", sign: "increase", amountCents: eur(1_000), nature: "permanent" }],
    }));
    expect(view.returnId).not.toBeNull();
    expect(view.result.priorBaseCents).toBe(eur(40_000));
    expect(view.result.grossQuotaCents).toBe(eur(8_400));
    expect(view.suggestions).toEqual([]);
  });

  it("pago fraccionado: cálculo, asiento del pago (473 a banco) y anulación", async () => {
    const before = await getInstallments(COMPANY, FY25);
    expect(before.periods.map((period) => [period.period, period.periodCode, period.dueDate])).toEqual([
      ["1P", "2025-1P", "2025-04-20"],
      ["2P", "2025-2P", "2025-10-20"],
      ["3P", "2025-3P", "2025-12-20"],
    ]);
    // Sin ejercicios anteriores en el programa no hay base para la modalidad del art. 40.2.
    expect(before.periods[1].quotaReference).toMatchObject({ source: "none", baseCents: 0 });
    // Modalidad del art. 40.3 hasta el 30 de septiembre: 39.000 al 15 % (5/7 del 21 %) menos 500 de retenciones.
    expect(before.periods[1].base).toMatchObject({ baseCents: eur(39_000), quotaCents: eur(5_850), withholdingsCents: eur(500), amountCents: eur(5_350) });

    const body = { method: "quota" as const, increasesCents: 0, decreasesCents: 0, bonusesCents: 0, quotaBaseCents: eur(10_000) };
    const saved = await saveInstallment(actor, FY25, "2P", body);
    expect(saved.periods[1]).toMatchObject({ saved: true, method: "quota", amountCents: eur(1_800) });
    await expect(payInstallment(actor, FY25, "1P", { date: "2025-04-15" })).rejects.toThrow("Guarda primero");

    const paid = await payInstallment(actor, FY25, "2P", { date: "2025-10-15" });
    expect(paid.periods[1].payment).toMatchObject({ date: "2025-10-15", amountCents: eur(1_800) });
    expect(await balance("473")).toBe(eur(2_300));
    // El 3P de la modalidad sobre la base descuenta lo ya ingresado y no lo cuenta como retención.
    expect(paid.periods[2].facts).toMatchObject({ previousInstallmentsCents: eur(1_800), ledgerWithholdingsCents: eur(500) });
    await expect(payInstallment(actor, FY25, "2P", { date: "2025-10-16" })).rejects.toThrow("ya está contabilizado");

    await undoInstallmentPayment(actor, FY25, "2P");
    expect(await balance("473")).toBe(eur(500));
    await payInstallment(actor, FY25, "2P", { date: "2025-10-15" });
    expect(await balance("473")).toBe(eur(2_300));
  });

  it("la liquidación separa retenciones y pagos fraccionados del saldo de la 473", async () => {
    const view = await getCorporateTaxYear(COMPANY, FY25);
    expect(view.facts).toMatchObject({ account473Cents: eur(2_300), installmentsPaidCents: eur(1_800), ledgerWithholdingsCents: eur(500) });
    expect(view.result).toMatchObject({ netQuotaCents: eur(8_400), withholdingsCents: eur(500), installmentsCents: eur(1_800), differentialCents: eur(6_100), outcome: "toPay" });
    expect(view.entry.lines.map((line) => [line.accountCode, line.debitCents, line.creditCents])).toEqual([
      ["6300", eur(8_400), 0],
      ["473", 0, eur(2_300)],
      ["4752", 0, eur(6_100)],
    ]);
  });

  it("contabiliza el impuesto con fecha de cierre y el cálculo no cambia por su propio asiento", async () => {
    const view = await postCorporateTaxEntry(actor, FY25);
    expect(view.entry.posted).not.toBeNull();
    expect(view.entry.upToDate).toBe(true);
    expect(view.facts.accountingResultBeforeTaxCents).toBe(eur(39_000));
    expect(view.facts.taxExpensePostedCents).toBe(eur(8_400));
    expect(view.facts.account473Cents).toBe(eur(2_300));
    expect(view.result.differentialCents).toBe(eur(6_100));
    expect(view.warnings.map((warning) => warning.code)).not.toContain("manual-tax-expense");
    expect(await balance("6300")).toBe(eur(8_400));
    expect(await balance("473")).toBe(0);
    expect(await balance("4752")).toBe(eur(-6_100));
    const entries = await taxEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].postedAt.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(view.reconciliation.map((row) => row.differenceCents)).toEqual([0, 0, 0]);
  });

  it("el punto del cierre lo da por bueno, y pide actualizarlo si cambia la liquidación", async () => {
    const item = async () => (await getCloseChecklist(COMPANY, FY25)).items.find((entry) => entry.id === "corporate-tax");
    expect(await item()).toMatchObject({ status: "ok", href: `/fiscal/sociedades?year=${FY25}` });

    const changed = await saveCorporateTaxReturn(actor, FY25, inputs({
      regime: "micro",
      adjustments: [
        { id: "a1", kind: "fines", concept: "Multas y sanciones (cuenta 678)", sign: "increase", amountCents: eur(1_000), nature: "permanent" },
        { id: "a2", kind: "depreciation-excess", concept: "Exceso de amortización", sign: "increase", amountCents: eur(2_000), nature: "temporaryOrigin" },
      ],
    }));
    expect(changed.entry.upToDate).toBe(false);
    expect(await item()).toMatchObject({ status: "pending", actionLabel: "Actualizar el asiento" });

    // Base 42.000 al 21 % = 8.820; la diferencia temporaria genera un activo por impuesto diferido de 420.
    const reposted = await postCorporateTaxEntry(actor, FY25);
    expect(reposted.entry.upToDate).toBe(true);
    expect(reposted.deferred).toEqual({ assetChangeCents: eur(420), liabilityChangeCents: 0, expenseCents: eur(-420) });
    const entries = await taxEntries();
    expect(entries).toHaveLength(3); // asiento original (anulado), su contraasiento y el nuevo
    expect(entries.filter((row: { reversedAt: Date | null; reversesEntryId: string | null }) => !row.reversedAt && !row.reversesEntryId)).toHaveLength(1);
    expect(await balance("6300")).toBe(eur(8_820));
    expect(await balance("6301")).toBe(eur(-420));
    expect(await balance("4740")).toBe(eur(420));
    expect(await balance("473")).toBe(0);
    expect(await balance("4752")).toBe(eur(-6_520));
    expect(await item()).toMatchObject({ status: "ok" });
  });

  it("anular el asiento deja el libro como estaba y el cierre lo vuelve a pedir", async () => {
    const view = await unpostCorporateTaxEntry(actor, FY25);
    expect(view.entry.posted).toBeNull();
    expect(await balance("630")).toBe(0);
    expect(await balance("473")).toBe(eur(2_300));
    expect((await getCloseChecklist(COMPANY, FY25)).items.find((entry) => entry.id === "corporate-tax")).toMatchObject({ status: "pending", actionLabel: "Contabilizar el impuesto" });
    await expect(unpostCorporateTaxEntry(actor, FY25)).rejects.toThrow("no está contabilizado");
    await postCorporateTaxEntry(actor, FY25);
    expect(await balance("6300")).toBe(eur(8_820));
  });

  it("presentada: se bloquea, alimenta el calendario y sirve de base al 202 del año siguiente", async () => {
    const filed = await markCorporateTaxReturnFiled(actor, FY25, { receiptNumber: "2001234567890" });
    expect(filed.status).toBe("filed");
    await expect(saveCorporateTaxReturn(actor, FY25, inputs())).rejects.toThrow("marcada como presentada");

    const calendar = await getCorporateTaxCalendarData(COMPANY, "ES");
    expect(calendar?.returns).toEqual([{ fiscalYearId: FY25, status: "filed", differentialCents: eur(6_520) }]);
    expect(calendar?.installments).toEqual([{ fiscalYearId: FY25, period: "2P", status: "draft", amountCents: eur(1_800) }]);
    expect(calendar?.reminders).toEqual({ relatedParties: false, books: true, annualAccounts: true });

    const next = await getInstallments(COMPANY, FY26);
    // 1P de 2026: el plazo del 200 de 2025 no ha vencido el 1 de abril y no hay ejercicios anteriores.
    expect(next.periods[0].quotaReference).toMatchObject({ source: "none", baseCents: 0 });
    // 2P de 2026: cuota íntegra de 2025 (8.820) menos retenciones (500), al 18 %.
    expect(next.periods[1].quotaReference).toEqual({ yearCode: "2025", source: "filed", baseCents: eur(8_320) });
    expect(next.periods[1].quota.amountCents).toBe(eur(1_497.6));
    expect(next.revenueCents).toBe(eur(100_000));
    expect(next.baseMethodMandatory).toBe(false);
  });

  it("ejercicio siguiente: propone microempresa y compensa las bases negativas anotadas", async () => {
    await saveManualLoss(actor, { originYear: 2023, amountCents: eur(5_000), notes: null });
    const register = await listLossRegister(COMPANY);
    expect(register.rows).toEqual([expect.objectContaining({ originYear: 2023, source: "manual", pendingCents: eur(5_000) })]);

    const view = await getCorporateTaxYear(COMPANY, FY26);
    expect(view.facts.ledgerPriorYearRevenueCents).toBe(eur(100_000));
    expect(view.suggestedRegime).toBe("micro");
    expect(view.inputs.regime).toBe("micro");
    expect(view.result.losses).toMatchObject({ availableCents: eur(5_000), appliedCents: eur(5_000), applied: [{ originYear: 2023, amountCents: eur(5_000) }] });
    // 15.000 al 19 % (microempresa, 2026).
    expect(view.result.taxableBaseCents).toBe(eur(15_000));
    expect(view.result.grossQuotaCents).toBe(eur(2_850));
    // El asiento de 2025 no contamina 2026: la 473 de 2026 no arrastra saldo.
    expect(view.facts.account473Cents).toBe(0);
  });

  it("una base negativa de una liquidación presentada queda disponible para el ejercicio siguiente", async () => {
    // 2026 pasa a pérdidas: gasto de 50.000.
    await entry("2026-03-01", [["600", 50_000, 0], ["572", 0, 50_000]]);
    const loss = await getCorporateTaxYear(COMPANY, FY26);
    expect(loss.result.taxableBaseCents).toBe(eur(-30_000));
    expect(loss.result.generatedLossCents).toBe(eur(30_000));
    expect(loss.entry.lines).toEqual([]);
    expect((await getCloseChecklist(COMPANY, FY26)).items.find((item) => item.id === "corporate-tax")).toMatchObject({ status: "ok" });

    await state.db.insert(fiscalYear).values({ id: "soc-fy2027", companyId: COMPANY, code: "2027", startsAt: day("2027-01-01"), endsAt: day("2027-12-31") });
    const unfiled = await getCorporateTaxYear(COMPANY, "soc-fy2027");
    expect(unfiled.losses.map((row) => row.originYear)).toEqual([2023]);
    expect(unfiled.warnings.map((warning) => warning.code)).toContain("prior-returns-unfiled");

    await saveCorporateTaxReturn(actor, FY26, inputs({ regime: "micro" }));
    await markCorporateTaxReturnFiled(actor, FY26, {});
    const next = await getCorporateTaxYear(COMPANY, "soc-fy2027");
    expect(next.losses.map((row) => [row.originYear, row.source, row.pendingCents])).toEqual([[2023, "manual", eur(5_000)], [2026, "return", eur(30_000)]]);
    expect(next.warnings.map((warning) => warning.code)).not.toContain("prior-returns-unfiled");
  });
});
