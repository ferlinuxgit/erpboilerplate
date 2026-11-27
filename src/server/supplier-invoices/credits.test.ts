import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Compensación de abonos de proveedor contra Postgres real (PGlite en memoria): la regla única de
 * «pendiente de pago» en SQL y en el servicio, el estado de la factura, el saldo a favor y la
 * devolución por banco. La contabilidad se simula (se comprueba el asiento que se pide).
 */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
}));
const mocks = vi.hoisted(() => ({
  createAutomaticEntry: vi.fn(async () => ({ id: "je-1", number: "AS-1" })),
  reverseAutomaticEntries: vi.fn(async () => 1),
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});
vi.mock("@/server/accounting/auto-post", () => ({
  createAutomaticEntry: mocks.createAutomaticEntry,
  reverseAutomaticEntries: mocks.reverseAutomaticEntries,
  resolveAccounts: vi.fn(async () => ({ ids: { bank: "acc-572", supplier: "acc-400" } })),
  resolveBankLedgerAccountId: vi.fn(async () => null),
}));
vi.mock("@/server/accounting/subaccounts", () => ({ ensurePartnerSubaccount: vi.fn(async () => ({ id: "acc-400-p1" })) }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: vi.fn(async () => undefined) }));

import * as schema from "@/db/schema";
import { bankAccount, company, partner, supplierCreditApplication, supplierInvoice, supplierInvoicePayment, supplierPayment, tenant, user } from "@/db/schema";
import {
  applySupplierCredit,
  applySupplierCreditInTransaction,
  listSupplierCreditBalances,
  registerSupplierCreditRefund,
  releaseSupplierCreditApplications,
  removeSupplierCreditApplication,
} from "@/server/supplier-invoices/credits";
import { supplierInvoiceOutstandingSql } from "@/server/supplier-invoices/outstanding";

const COMPANY = "company-1";
const actor = { tenantId: "tenant-1", companyId: COMPANY, actorUserId: "user-1" };

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: COMPANY, tenantId: "tenant-1", name: "Empresa", legalName: "Empresa SL", vatNumber: "B12345678" });
  await state.db.insert(partner).values([
    { id: "p-1", companyId: COMPANY, number: "P1", type: "SUPPLIER", name: "Proveedor Uno" },
    { id: "p-2", companyId: COMPANY, number: "P2", type: "SUPPLIER", name: "Proveedor Dos" },
  ]);
  await state.db.insert(bankAccount).values({ id: "bank-1", companyId: COMPANY, bankName: "Banco", iban: "ES9121000418450200051332" });
}, 60_000);

afterAll(async () => {
  await state.client?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await state.db.delete(supplierPayment);
  await state.db.delete(supplierInvoice);
});

async function document(id: string, total: string, extra: Partial<typeof supplierInvoice.$inferInsert> = {}) {
  await state.db.insert(supplierInvoice).values({
    id,
    companyId: COMPANY,
    supplierPartnerId: "p-1",
    number: id.toUpperCase(),
    totalAmount: total,
    paymentStatus: Number(total) <= 0 ? "PAID" : "PENDING",
    documentKind: Number(total) < 0 ? "RECTIFICATION" : "INVOICE",
    ...extra,
  });
}

async function pay(invoiceId: string, amount: string) {
  const [payment] = await state.db.insert(supplierPayment).values({ companyId: COMPANY, number: `PA-${invoiceId}-${amount}`, supplierPartnerId: "p-1", supplierInvoiceId: invoiceId, amount, postedAt: new Date() }).returning();
  await state.db.insert(supplierInvoicePayment).values({ companyId: COMPANY, supplierInvoiceId: invoiceId, supplierPaymentId: payment.id, amountApplied: amount });
}

async function outstandingOf(id: string) {
  const [row] = await state.db
    .select({ outstanding: supplierInvoiceOutstandingSql.mapWith(Number), paymentStatus: supplierInvoice.paymentStatus })
    .from(supplierInvoice)
    .where(eq(supplierInvoice.id, id));
  return row as { outstanding: number; paymentStatus: string };
}

describe("compensación de abonos de proveedor", () => {
  it("un abono parcial reduce lo pendiente de su factura y la deja en pago parcial", async () => {
    await document("f-1", "121.00");
    await document("c-1", "-21.00", { rectifiedInvoiceId: "f-1" });
    const result = await state.db.transaction((tx: never) => applySupplierCreditInTransaction(tx, actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-1" }));
    expect(result?.amount).toBe(21);
    expect(await outstandingOf("f-1")).toEqual({ outstanding: 100, paymentStatus: "PARTIAL" });
    expect(await listSupplierCreditBalances(COMPANY, "p-1")).toEqual([]);
    // La compensación no contabiliza nada.
    expect(mocks.createAutomaticEntry).not.toHaveBeenCalled();
  });

  it("un abono total deja la factura pagada sin pagos", async () => {
    await document("f-1", "121.00");
    await document("c-1", "-121.00");
    await applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-1" });
    expect(await outstandingOf("f-1")).toEqual({ outstanding: 0, paymentStatus: "PAID" });
  });

  it("si el abono supera lo pendiente, el resto queda como saldo a favor aplicable a otra factura", async () => {
    await document("f-1", "100.00");
    await pay("f-1", "60.00");
    await document("f-2", "50.00");
    await document("c-1", "-100.00");
    await applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-1" });
    expect((await outstandingOf("f-1")).outstanding).toBe(0);
    expect(await listSupplierCreditBalances(COMPANY, "p-1")).toMatchObject([{ id: "c-1", remaining: 60 }]);

    await applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-2", amount: 20 });
    expect(await outstandingOf("f-2")).toEqual({ outstanding: 30, paymentStatus: "PARTIAL" });
    expect(await listSupplierCreditBalances(COMPANY)).toMatchObject([{ id: "c-1", remaining: 40 }]);
  });

  it("no deja compensar más que el saldo del abono ni que lo pendiente, ni entre proveedores distintos", async () => {
    await document("f-1", "100.00");
    await document("c-1", "-30.00");
    await document("f-other", "100.00", { supplierPartnerId: "p-2" });
    await expect(applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-1", amount: 31 })).rejects.toMatchObject({ code: "SUPPLIER_CREDIT_OVER" });
    await expect(applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-other" })).rejects.toMatchObject({ code: "SUPPLIER_CREDIT_PARTNER_MISMATCH" });
    await expect(applySupplierCredit(actor, { creditInvoiceId: "f-1", supplierInvoiceId: "f-other" })).rejects.toMatchObject({ code: "SUPPLIER_CREDIT_NOT_CREDIT" });
    await pay("f-1", "100.00");
    await expect(applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-1" })).rejects.toMatchObject({ code: "SUPPLIER_CREDIT_NOTHING" });
  });

  it("al quitar la compensación la factura recupera su pendiente y el abono su saldo", async () => {
    await document("f-1", "100.00");
    await document("c-1", "-100.00");
    const { application } = await applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-1" });
    await expect(removeSupplierCreditApplication(actor, application.id)).resolves.toBe(true);
    expect(await outstandingOf("f-1")).toEqual({ outstanding: 100, paymentStatus: "PENDING" });
    expect(await listSupplierCreditBalances(COMPANY)).toMatchObject([{ id: "c-1", remaining: 100 }]);
    await expect(removeSupplierCreditApplication(actor, "missing")).resolves.toBe(false);
  });

  it("al anular el abono se sueltan sus compensaciones", async () => {
    await document("f-1", "100.00");
    await document("c-1", "-40.00");
    await applySupplierCredit(actor, { creditInvoiceId: "c-1", supplierInvoiceId: "f-1" });
    const released = await state.db.transaction((tx: never) => releaseSupplierCreditApplications(tx, COMPANY, { id: "c-1", number: "C-1" }));
    expect(released).toBe(1);
    expect(await outstandingOf("f-1")).toEqual({ outstanding: 100, paymentStatus: "PENDING" });
  });

  it("la devolución por banco se contabiliza banco a proveedor y consume el saldo a favor", async () => {
    await document("c-1", "-80.00");
    await expect(registerSupplierCreditRefund(actor, { creditInvoiceId: "c-1", amount: 81, postedAt: new Date("2026-10-01"), bankAccountId: "bank-1" })).rejects.toMatchObject({ code: "SUPPLIER_CREDIT_OVER" });
    const refund = await registerSupplierCreditRefund(actor, { creditInvoiceId: "c-1", amount: 50, postedAt: new Date("2026-10-01"), bankAccountId: "bank-1" });
    expect(mocks.createAutomaticEntry).toHaveBeenCalledWith(expect.objectContaining({
      entityName: "supplierCreditRefund",
      entityId: refund.application.id,
      lines: [
        expect.objectContaining({ accountId: "acc-572", debit: 50, credit: 0 }),
        expect.objectContaining({ accountId: "acc-400-p1", debit: 0, credit: 50, documentId: "c-1" }),
      ],
    }));
    expect(await listSupplierCreditBalances(COMPANY)).toMatchObject([{ id: "c-1", remaining: 30 }]);

    // Un abono con devolución cobrada no se puede anular sin quitarla antes.
    await expect(state.db.transaction((tx: never) => releaseSupplierCreditApplications(tx, COMPANY, { id: "c-1", number: "C-1" }))).rejects.toMatchObject({ code: "SUPPLIER_CREDIT_REFUNDED" });
    await removeSupplierCreditApplication(actor, refund.application.id);
    expect(mocks.reverseAutomaticEntries).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "supplierCreditRefund", sourceId: refund.application.id }));
    const rows = await state.db.select().from(supplierCreditApplication).orderBy(asc(supplierCreditApplication.createdAt));
    expect(rows).toEqual([]);
  });
});
