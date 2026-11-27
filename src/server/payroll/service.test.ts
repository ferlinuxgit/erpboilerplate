import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Nóminas y modelos de retenciones contra Postgres real (PGlite en memoria, esquema completo de
 * Drizzle): asientos de nóminas, pagos y rendimientos del capital, sus anulaciones, el bloqueo por
 * periodos presentados y los modelos 111, 115, 123, 190, 180 y 193 calculados desde la base de datos.
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
import {
  accountChart,
  company,
  companySettings,
  fiscalReport,
  fiscalYear,
  journalEntry,
  journalLine,
  partner,
  payrollSlip,
  supplierInvoice,
  supplierInvoiceLine,
  supplierInvoicePayment,
  supplierPayment,
  tenant,
  user,
} from "@/db/schema";
import { ensureSubaccount } from "@/server/accounting/subaccounts";
import { calculateSpanishFiscalSummary } from "@/server/fiscal/spain";
import {
  createCapitalIncome,
  createEmployee,
  createPayrollPayment,
  createRentalProperty,
  createSlip,
  deleteCapitalIncome,
  deletePayrollPayment,
  getPeriodSummary,
  importSlips,
  postPeriod,
  savePayrollSettings,
  unpostSlip,
} from "@/server/payroll/service";
import { getWithholdingActivity, loadWithholdingModel, sumPayrollLedgerWithholdings } from "@/server/payroll/withholding-data";

const TENANT = "tenant-1";
const USER = "user-1";
const COMPANY = "company-1";
const actor = { tenantId: TENANT, companyId: COMPANY, actorUserId: USER };

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: USER, name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: TENANT, name: "T", slug: "t", ownerId: USER });
  await state.db.insert(company).values({ id: COMPANY, tenantId: TENANT, name: "Empresa", countryCode: "ES" });
  await state.db.insert(companySettings).values({ companyId: COMPANY, subaccountLength: 8, businessType: "both" });
  await state.db.insert(fiscalYear).values([
    { id: "fy2026", companyId: COMPANY, code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) },
    { id: "fy2027", companyId: COMPANY, code: "2027", startsAt: new Date(Date.UTC(2027, 0, 1)), endsAt: new Date(Date.UTC(2027, 11, 31)) },
  ]);
}, 120_000);

afterAll(async () => {
  await state.client?.close();
});

async function entryLines(entryId: string) {
  const rows = await state.db
    .select({ code: accountChart.code, debit: journalLine.debit, credit: journalLine.credit })
    .from(journalLine)
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(eq(journalLine.journalEntryId, entryId))
    .orderBy(asc(journalLine.lineNumber));
  return (rows as Array<{ code: string; debit: string; credit: string }>).map((row) => [row.code, Number(row.debit), Number(row.credit)]);
}

async function slipRow(id: string) {
  const [row] = await state.db.select().from(payrollSlip).where(eq(payrollSlip.id, id));
  return row as typeof payrollSlip.$inferSelect;
}

/** Factura recibida con retención, insertada directamente (sin asiento): solo datos para los modelos. */
async function insertInvoice(input: { id: string; partnerId: string; date: string; base: number; rate: number; accountCode: string }) {
  const account = await ensureSubaccount(COMPANY, input.accountCode);
  const retention = (input.base * input.rate) / 100;
  const total = input.base * 1.21 - retention;
  await state.db.insert(supplierInvoice).values({
    id: input.id,
    companyId: COMPANY,
    supplierPartnerId: input.partnerId,
    number: `FR-${input.id}`,
    issueDate: new Date(`${input.date}T10:00:00.000Z`),
    accountingDate: new Date(`${input.date}T10:00:00.000Z`),
    subtotalAmount: input.base.toFixed(2),
    taxAmount: (input.base * 0.21).toFixed(2),
    retentionAmount: retention.toFixed(2),
    totalAmount: total.toFixed(2),
  });
  await state.db.insert(supplierInvoiceLine).values({
    supplierInvoiceId: input.id,
    expenseAccountId: account.id,
    description: "Servicio",
    quantity: "1",
    unitPrice: input.base.toFixed(2),
    retentionRate: String(input.rate),
    subtotalAmount: input.base.toFixed(2),
    taxAmount: (input.base * 0.21).toFixed(2),
    retentionAmount: retention.toFixed(2),
    lineTotal: total.toFixed(2),
  });
  return total;
}

async function payInvoice(invoiceId: string, partnerId: string, date: string, amount: number) {
  const paymentId = `pay-${invoiceId}`;
  await state.db.insert(supplierPayment).values({ id: paymentId, companyId: COMPANY, number: `PP-${invoiceId}`, supplierPartnerId: partnerId, supplierInvoiceId: invoiceId, amount: amount.toFixed(2), postedAt: new Date(`${date}T10:00:00.000Z`) });
  await state.db.insert(supplierInvoicePayment).values({ companyId: COMPANY, supplierInvoiceId: invoiceId, supplierPaymentId: paymentId, amountApplied: amount.toFixed(2) });
}

const box = (boxes: Array<{ box: string; amount: number }>, code: string) => boxes.find((entry) => entry.box === code)?.amount;

describe("nóminas: asiento, pago y anulación", () => {
  let employeeId = "";
  let directorId = "";
  let januarySlipId = "";

  it("contabiliza la nómina con 640 y 642 al debe y 4751, 476, 460 y 465 al haber", async () => {
    employeeId = (await createEmployee(actor, { name: "Luis Empleado", taxId: "11111111-H", recipientKind: "employee", withholdingRate: 15, birthYear: 1985, familySituation: 3, contractType: 1 })).id;
    directorId = (await createEmployee(actor, { name: "Marta Administradora", taxId: "33333333P", recipientKind: "director", subkey190: "04", withholdingRate: 35 })).id;

    januarySlipId = (await createSlip(actor, {
      employeeId,
      period: "2026-01",
      grossAmount: 2000,
      withholdingAmount: 300,
      employeeSocialSecurity: 127,
      employerSocialSecurity: 620,
      advancesAmount: 100,
      netAmount: 1473,
      post: true,
    })).id;
    const slip = await slipRow(januarySlipId);
    expect(slip.status).toBe("posted");
    expect(slip.accrualDate).toBe("2026-01-31");
    expect(await entryLines(slip.journalEntryId ?? "")).toEqual([
      ["64000000", 2000, 0],
      ["64200000", 620, 0],
      ["47510000", 0, 300],
      ["47600000", 0, 747],
      ["46000000", 0, 100],
      ["46500000", 0, 1473],
    ]);
    const [entry] = await state.db.select().from(journalEntry).where(eq(journalEntry.id, slip.journalEntryId ?? ""));
    expect(entry).toMatchObject({ sourceType: "payrollSlip", sourceId: januarySlipId, isAutomatic: true });
    expect(entry.postedAt.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("rechaza una nómina que no cuadra y un duplicado del mismo mes", async () => {
    await expect(createSlip(actor, { employeeId, period: "2026-02", grossAmount: 2000, withholdingAmount: 300, netAmount: 1800 })).rejects.toMatchObject({ code: "PAYROLL_UNBALANCED" });
    await expect(createSlip(actor, { employeeId, period: "2026-01", grossAmount: 2000, netAmount: 2000 })).rejects.toMatchObject({ code: "PAYROLL_SLIP_DUPLICATE" });
  });

  it("importa las nóminas del mes, las deja en borrador y «contabilizar el mes» las apunta todas", async () => {
    const text = "NIF;Bruto;Especie;IRPF;Ingreso a cuenta;SS trabajador;SS empresa;Anticipos;Líquido\n11111111H;2.000,00;100,00;300,00;15,00;127,00;620,00;0;1.558,00\n33333333P;3.000,00;0;1.050,00;0;0;0;0;1.950,00";
    const check = await importSlips(actor, { period: "2026-02", text });
    expect(check).toMatchObject({ valid: 2, invalid: 0, created: 0 });
    const imported = await importSlips(actor, { period: "2026-02", text, commit: true });
    expect(imported.created).toBe(2);
    expect((await getPeriodSummary(COMPANY, "2026-02")).drafts).toBe(2);
    expect(await postPeriod(actor, "2026-02")).toEqual({ period: "2026-02", posted: 2 });
    const summary = await getPeriodSummary(COMPANY, "2026-02");
    expect(summary).toMatchObject({ drafts: 0, grossCents: 500_000, withholdingCents: 136_500, pendingSalariesCents: 350_800, pendingSocialSecurityCents: 74_700 });
    expect(directorId).not.toBe("");
  });

  it("paga las nóminas (465 a banco) y los seguros sociales (476 a banco), y marca las nóminas como pagadas", async () => {
    const salaries = await createPayrollPayment(actor, { kind: "salaries", period: "2026-01", paymentDate: "2026-02-02" });
    expect(salaries.amountCents).toBe(147_300);
    expect(await entryLines(salaries.journalEntryId ?? "")).toEqual([["46500000", 1473, 0], ["57200000", 0, 1473]]);
    expect((await slipRow(januarySlipId)).paymentDate).toBe("2026-02-02");

    const social = await createPayrollPayment(actor, { kind: "socialSecurity", period: "2026-01", paymentDate: "2026-02-27" });
    expect(await entryLines(social.journalEntryId ?? "")).toEqual([["47600000", 747, 0], ["57200000", 0, 747]]);
    const summary = await getPeriodSummary(COMPANY, "2026-01");
    expect(summary).toMatchObject({ pendingSalariesCents: 0, pendingSocialSecurityCents: 0 });
    expect(summary.payments).toHaveLength(2);
    await expect(createPayrollPayment(actor, { kind: "salaries", period: "2026-01", paymentDate: "2026-02-03" })).rejects.toMatchObject({ code: "PAYROLL_ALREADY_PAID" });
  });

  it("no deja descontabilizar una nómina pagada; al anular el pago sí, con contraasiento", async () => {
    await expect(unpostSlip(actor, januarySlipId, "2026-03-01")).rejects.toMatchObject({ code: "PAYROLL_SLIP_PAID" });
    const summary = await getPeriodSummary(COMPANY, "2026-01");
    const salaries = summary.payments.find((payment) => payment.kind === "salaries");
    await deletePayrollPayment(actor, salaries?.id ?? "", "2026-03-01");
    expect((await slipRow(januarySlipId)).paymentDate).toBeNull();

    await unpostSlip(actor, januarySlipId, "2026-03-01");
    const slip = await slipRow(januarySlipId);
    expect(slip).toMatchObject({ status: "draft", journalEntryId: null });
    const entries = await state.db.select().from(journalEntry).where(and(eq(journalEntry.sourceType, "payrollSlip"), eq(journalEntry.sourceId, januarySlipId)));
    expect(entries).toHaveLength(2);
    expect(entries.filter((entry: { reversesEntryId: string | null }) => entry.reversesEntryId !== null)).toHaveLength(1);
    // Las retenciones de enero quedan a cero en el mayor (asiento y contraasiento).
    expect(await sumPayrollLedgerWithholdings(COMPANY, new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 1, 1)))).toBe(0);
    // Se vuelve a contabilizar para el resto de pruebas.
    expect((await postPeriod(actor, "2026-01")).posted).toBe(1);
  });
});

describe("modelos de retenciones desde la base de datos", () => {
  const LAWYER = "partner-lawyer";
  const LANDLORD = "partner-landlord";

  it("111: nóminas en rendimientos del trabajo y facturas de profesionales en actividades económicas", async () => {
    await state.db.insert(partner).values([
      { id: LAWYER, companyId: COMPANY, number: "P-1", type: "SUPPLIER", name: "Ana Abogada", taxId: "12345678Z" },
      { id: LANDLORD, companyId: COMPANY, number: "P-2", type: "SUPPLIER", name: "Locales SL", taxId: "B12345678" },
    ]);
    const lawyerTotal = await insertInvoice({ id: "inv-lawyer", partnerId: LAWYER, date: "2026-03-20", base: 1000, rate: 15, accountCode: "623" });
    await insertInvoice({ id: "inv-rent", partnerId: LANDLORD, date: "2026-02-01", base: 800, rate: 19, accountCode: "621" });
    await payInvoice("inv-lawyer", LAWYER, "2026-04-10", lawyerTotal);

    const model = await loadWithholdingModel(COMPANY, "111", "2026-Q1");
    const boxes = model?.summary.boxes ?? [];
    // Enero: Luis 2.000 / 300. Febrero: Luis 2.000 / 300 (+100 en especie, 15 a cuenta) y Marta 3.000 / 1.050.
    expect(box(boxes, "01")).toBe(2);
    expect(box(boxes, "02")).toBe(7000);
    expect(box(boxes, "03")).toBe(1650);
    expect(box(boxes, "04")).toBe(1);
    expect(box(boxes, "05")).toBe(100);
    expect(box(boxes, "06")).toBe(15);
    expect(box(boxes, "07")).toBe(1);
    expect(box(boxes, "08")).toBe(1000);
    expect(box(boxes, "09")).toBe(150);
    expect(box(boxes, "28")).toBe(1815);
    expect(box(boxes, "30")).toBe(1815);
    expect(model?.summary.checks.map((check) => check.code)).toContain("withholding-registration-basis");
  });

  it("115 y 180: alquileres de la cuenta 621 con su inmueble", async () => {
    const model115 = await loadWithholdingModel(COMPANY, "115", "2026-Q1");
    expect(model115?.summary.boxes.map((entry) => entry.amount)).toEqual([1, 800, 152, 0, 152]);

    await createRentalProperty(actor, { supplierPartnerId: LANDLORD, situation: "1", cadastralReference: "9872023VH5797S0001WX", address: "Calle Mayor 1", city: "Madrid" });
    const model180 = await loadWithholdingModel(COMPANY, "180", "2026");
    expect(model180?.summary.modelo180?.recipients).toEqual([
      expect.objectContaining({ taxId: "B12345678", baseCents: 80_000, withheldCents: 15_200, rate: 19, property: expect.objectContaining({ cadastralReference: "9872023VH5797S0001WX", situation: "1" }) }),
    ]);
    expect(model180?.summary.modelo180?.reconciliation.balanced).toBe(true);
  });

  it("190: empleados (A), administradores (E) y profesionales (G), cuadrado con los 111", async () => {
    const model = await loadWithholdingModel(COMPANY, "190", "2026");
    const result = model?.summary.modelo190;
    expect(result?.recipients.map((row) => [row.key, row.subkey, row.taxId, row.cashCents, row.withheldCents, row.inKindCents, row.inKindWithheldCents])).toEqual([
      ["A", null, "11111111H", 400_000, 60_000, 10_000, 1_500],
      ["E", "04", "33333333P", 300_000, 105_000, 0, 0],
      ["G", "01", "12345678Z", 100_000, 15_000, 0, 0],
    ]);
    expect(result?.recipients[0].personal).toMatchObject({ birthYear: 1985, familySituation: 3, contractType: 1 });
    expect(result?.totalWithheldCents).toBe(181_500);
    expect(result?.reconciliation).toMatchObject({ balanced: true, periodicCents: 181_500 });
    expect(model?.summary.checks.filter((check) => check.status === "blocking")).toEqual([]);
  });

  it("190: si un 111 presentado ya no coincide con los datos, el aviso es bloqueante", async () => {
    await state.db.insert(fiscalReport).values({
      id: "report-111-q1",
      companyId: COMPANY,
      code: "111",
      period: "2026-Q1",
      status: "FILED",
      filedSnapshot: { version: 1, takenAt: new Date().toISOString(), summary: { code: "111", modelo303Boxes: [], amountDue: 1000 } },
    });
    const model = await loadWithholdingModel(COMPANY, "190", "2026");
    expect(model?.summary.modelo190?.reconciliation).toMatchObject({ balanced: false, periodicCents: 100_000, differenceCents: 81_500 });
    expect(model?.summary.checks.find((check) => check.code === "model-190-reconciliation")?.status).toBe("blocking");
  });

  it("un periodo presentado bloquea los asientos de nóminas con fecha dentro de él", async () => {
    const [luis] = await state.db.select().from(schema.payrollEmployee).where(eq(schema.payrollEmployee.taxId, "11111111H"));
    await expect(createSlip(actor, { employeeId: luis.id, period: "2026-03", grossAmount: 2000, netAmount: 2000, post: true })).rejects.toMatchObject({ code: "FISCAL_PERIOD_LOCKED" });
    await state.db.delete(fiscalReport).where(eq(fiscalReport.id, "report-111-q1"));
  });

  it("por fecha de pago, la factura pagada en abril pasa al segundo trimestre y la impagada avisa", async () => {
    await savePayrollSettings(actor, { invoiceWithholdingBasis: "payment", payrollWithholdingBasis: "accrual", enabledModels: ["193"] });
    const first = await loadWithholdingModel(COMPANY, "111", "2026-Q1");
    expect(box(first?.summary.boxes ?? [], "09")).toBe(0);
    const second = await loadWithholdingModel(COMPANY, "111", "2026-Q2");
    expect(box(second?.summary.boxes ?? [], "09")).toBe(150);
    expect(second?.items.find((item) => item.source === "supplierInvoice")).toMatchObject({ date: "2026-04-10", allocation: "payment" });
    // El alquiler no tiene pago registrado: se queda en su fecha de registro con aviso.
    const rent = await loadWithholdingModel(COMPANY, "115", "2026-Q1");
    expect(rent?.summary.checks.map((check) => check.code)).toEqual(["withholding-unpaid"]);
    await savePayrollSettings(actor, { invoiceWithholdingBasis: "registration", payrollWithholdingBasis: "accrual", enabledModels: ["193"] });
  });

  it("123 y 193: dividendo con su asiento (526 a 4751 y banco) y eliminación con contraasiento", async () => {
    const dividend = await createCapitalIncome(actor, { recipientName: "Socio Uno", recipientTaxId: "44444444A", kind: "dividend", paymentDate: "2026-06-15", grossAmount: 10_000, withholdingRate: 19, withholdingAmount: 1900 });
    expect(await entryLines(dividend.journalEntryId)).toEqual([["52600000", 10_000, 0], ["47510000", 0, 1900], ["57200000", 0, 8100]]);
    const interest = await createCapitalIncome(actor, { recipientName: "Prestamista", recipientTaxId: "55555555K", kind: "interest", paymentDate: "2026-06-30", grossAmount: 200, withholdingRate: 19, withholdingAmount: 38 });

    const model123 = await loadWithholdingModel(COMPANY, "123", "2026-Q2");
    const boxes = model123?.summary.boxes ?? [];
    expect([box(boxes, "01"), box(boxes, "02"), box(boxes, "06"), box(boxes, "09"), box(boxes, "14")]).toEqual([1, 1, 10_200, 1938, 1938]);

    const model193 = await loadWithholdingModel(COMPANY, "193", "2026");
    expect(model193?.summary.modelo193?.recipients.map((row) => [row.key, row.nature, row.taxId, row.withheldCents])).toEqual([["A", "02", "44444444A", 190_000], ["B", "03", "55555555K", 3_800]]);
    expect(model193?.summary.modelo193?.reconciliation.balanced).toBe(true);

    await deleteCapitalIncome(actor, interest.id);
    const after = await loadWithholdingModel(COMPANY, "123", "2026-Q2");
    expect(box(after?.summary.boxes ?? [], "09")).toBe(1900);
  });

  it("el resumen fiscal del 111 lleva el modelo completo y concilia la 4751 con las nóminas", async () => {
    const summary = await calculateSpanishFiscalSummary(COMPANY, "111", "2026-Q1");
    expect(summary.withholdingModel?.code).toBe("111");
    expect(summary.amountDue).toBe(1815);
    expect(summary.withholdingAmount).toBe(1815);
    // Las facturas de la prueba no tienen asiento: la 4751 solo recoge las nóminas (1.665 €).
    expect(summary.accountingReconciliation.withholdings.accountingAmount).toBe(1665);
    expect(summary.accountingReconciliation.withholdings.fiscalAmount).toBe(1665 + 150 + 152);

    const annual = await calculateSpanishFiscalSummary(COMPANY, "190", "2026");
    expect(annual.amountDue).toBeNull();
    expect(annual.withholdingModel?.modelo190?.recordCount).toBe(3);
    expect(annual.dueDate?.slice(0, 10)).toBe("2027-02-01");
  });

  it("actividad para el calendario: nóminas, profesionales, alquileres y capital", async () => {
    expect(await getWithholdingActivity(COMPANY, "2026-01-01", "2027-01-01")).toEqual({ payroll: true, capitalIncome: true, professional: true, rent: true, enabledModels: ["193"] });
    expect(await getWithholdingActivity(COMPANY, "2025-01-01", "2026-01-01")).toMatchObject({ payroll: false, capitalIncome: false, professional: false, rent: false });
  });
});
