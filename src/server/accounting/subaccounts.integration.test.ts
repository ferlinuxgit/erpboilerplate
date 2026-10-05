import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Plan por subcuentas contra Postgres real (PGlite en memoria, esquema completo de Drizzle):
 * subcuentas canónicas y de terceros, asientos automáticos con concepto/tercero/documento,
 * numeración por ejercicio, cuadre fiscal y cierre con subcuentas, y la reclasificación de datos
 * antiguos (sumas por grupo intactas e idempotencia).
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
  auditLog,
  company,
  companySettings,
  fiscalYear,
  invoice,
  item,
  journal,
  journalEntry,
  journalLine,
  partner,
  payment,
  supplierInvoice,
  supplierPayment,
  tenant,
  user,
} from "@/db/schema";
import {
  postBankTransaction,
  postCustomerPayment,
  postSalesInvoice,
  postSupplierInvoice,
  postSupplierPayment,
} from "@/server/accounting/auto-post";
import { runBankSubaccountAssignment } from "@/server/accounting/bank-subaccounts";
import { closeFiscalYear } from "@/server/accounting/fiscal-years";
import { reclassifyCompany, runReclassification } from "@/server/accounting/reclassify";
import { createAccount, createJournalEntry, listAccounts, updateSubaccountLength } from "@/server/accounting/service";
import { ensurePartnerSubaccount, ensureSubaccount } from "@/server/accounting/subaccounts";
import { createCustomerWithPartner } from "@/server/customers/service";
import { fetchAccountingTaxBalances } from "@/server/fiscal/spain";
import { applyEsSeeds } from "@/server/seeds/apply";
import { createSupplierWithPartner } from "@/server/suppliers/service";
import { getCompanyDefaultsStatus } from "@/server/company/defaults";
import { dedupeCompanyTaxes } from "@/server/taxes/duplicates";
import { ensureCashPaymentMethod } from "@/server/treasury/cash-payment-method";
import { createBankAccount, recordBankTransaction } from "@/server/treasury/service";
import { applyAllocations, getReconciliationWorkbench } from "@/server/treasury/workbench";
import type { DbClient } from "@/lib/db";

const TENANT = "tenant-1";
const USER = "user-1";

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: USER, name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: TENANT, name: "T", slug: "t", ownerId: USER });
}, 120_000);

afterAll(async () => {
  await state.client?.close();
});

async function createCompany(id: string, options: { subaccountLength?: number; businessType?: string } = {}) {
  await state.db.insert(company).values({ id, tenantId: TENANT, name: `Empresa ${id}`, countryCode: "ES" });
  await state.db.insert(companySettings).values({ companyId: id, subaccountLength: options.subaccountLength ?? 8, businessType: options.businessType ?? "both" });
  await state.db.insert(fiscalYear).values([
    { id: `${id}-fy2025`, companyId: id, code: "2025", startsAt: new Date(Date.UTC(2025, 0, 1)), endsAt: new Date(Date.UTC(2025, 11, 31)) },
    { id: `${id}-fy2026`, companyId: id, code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) },
  ]);
}

async function accountByCode(companyId: string, code: string) {
  const [row] = await state.db.select().from(accountChart).where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, code))).limit(1);
  return row as typeof accountChart.$inferSelect | undefined;
}

async function entryLines(entryId: string) {
  return state.db
    .select({
      code: accountChart.code,
      debit: journalLine.debit,
      credit: journalLine.credit,
      concept: journalLine.concept,
      partnerId: journalLine.partnerId,
      documentType: journalLine.documentType,
      documentNumber: journalLine.documentNumber,
      documentId: journalLine.documentId,
      dueDate: journalLine.dueDate,
      lineNumber: journalLine.lineNumber,
    })
    .from(journalLine)
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(eq(journalLine.journalEntryId, entryId))
    .orderBy(asc(journalLine.lineNumber));
}

async function entryBySource(companyId: string, sourceType: string, sourceId: string) {
  const [row] = await state.db
    .select({ id: journalEntry.id, number: journalEntry.number, fiscalYearId: journalEntry.fiscalYearId, journalCode: journal.code })
    .from(journalEntry)
    .innerJoin(journal, eq(journal.id, journalEntry.journalId))
    .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.sourceType, sourceType), eq(journalEntry.sourceId, sourceId)))
    .limit(1);
  return row as { id: string; number: string; fiscalYearId: string | null; journalCode: string };
}

const actor = (companyId: string) => ({ tenantId: TENANT, companyId, actorUserId: USER });

const customerInput = (name: string, taxId: string) => ({
  name,
  taxId,
  address: "Calle Mayor 1",
  postalCode: "28001",
  city: "Madrid",
  province: "Madrid",
  countryCode: "ES",
});

describe("subcuentas canónicas (ensureSubaccount)", () => {
  it.each([8, 9, 10, 11, 12])("con longitud %i lleva 477, 4770, 700000, 4751 y 572 a su subcuenta con su cadena de grupos del PGC", async (length) => {
    const companyId = `sub-${length}`;
    await createCompany(companyId, { subaccountLength: length });
    const pad = (code: string) => code.padEnd(length, "0");

    const vat = await ensureSubaccount(companyId, "477");
    expect(vat.code).toBe(pad("477"));
    expect(vat.name).toBe("Hacienda Pública, IVA repercutido");
    expect((await ensureSubaccount(companyId, "4770")).id).toBe(vat.id);
    expect((await ensureSubaccount(companyId, "477")).id).toBe(vat.id);
    expect((await ensureSubaccount(companyId, "700000")).code).toBe(pad("700"));
    const retention = await ensureSubaccount(companyId, "4751");
    expect(retention.code).toBe(pad("4751"));
    expect((await ensureSubaccount(companyId, "572")).code).toBe(pad("572"));

    const created = await accountByCode(companyId, pad("4751"));
    expect(created).toMatchObject({ parentCode: "4751", isPostable: true, level: length, type: "LIABILITY", nature: "CREDIT" });
    // La cadena de grupos del PGC se crea sin apuntes.
    for (const code of ["4", "47", "475", "4751"]) expect(await accountByCode(companyId, code)).toMatchObject({ isPostable: false });

    await expect(ensureSubaccount(companyId, "47A")).rejects.toThrow("no se puede convertir");
    await expect(ensureSubaccount(companyId, "4".repeat(length + 1))).rejects.toThrow("no se puede convertir");
  });
});

describe("subcuentas de terceros", () => {
  it("numera 430/400/410 + número del tercero, evita colisiones y separa cliente y proveedor", async () => {
    const companyId = "partners";
    await createCompany(companyId, { businessType: "services" });

    const createdCustomer = await createCustomerWithPartner(state.db, companyId, customerInput("Pérez S.L.", "B12345674"));
    const [customerPartner] = await state.db.select().from(partner).where(eq(partner.id, createdCustomer.partnerId as string));
    expect(customerPartner.number).toBe("CL000001");
    const customerAccount = await accountByCode(companyId, "43000001");
    expect(customerAccount).toMatchObject({ name: "Pérez S.L.", partnerId: customerPartner.id, parentCode: "4300", isPostable: true });
    expect(customerPartner.defaultAccountId).toBe(customerAccount?.id);

    // Empresa de servicios: los proveedores van por defecto a 410 (acreedores por servicios).
    const supplier = await createSupplierWithPartner(state.db, companyId, { ...customerInput("Asesoría Luna", "B87654313"), paymentTermsDays: 30, currencyCode: "EUR" });
    expect(supplier.number).toBe("PR000002");
    expect(await accountByCode(companyId, "41000002")).toMatchObject({ partnerId: supplier.id, parentCode: "4100" });

    // El código 43000003 ya lo usa otra cuenta: el siguiente cliente recibe la siguiente libre.
    await state.db.insert(accountChart).values({ companyId, code: "43000003", name: "Manual", type: "ASSET", parentCode: "4300", level: 8 });
    const third = await createCustomerWithPartner(state.db, companyId, customerInput("Tercero", "B11111119"));
    const thirdAccount = await ensurePartnerSubaccount({ id: third.partnerId as string, companyId }, { role: "customer" });
    expect(thirdAccount.code).toBe("43000004");

    // Cliente que también es proveedor: dos subcuentas y la principal es la de proveedor.
    const both = await createSupplierWithPartner(state.db, companyId, { ...customerInput("Pérez S.L.", "B12345674"), paymentTermsDays: 30, currencyCode: "EUR", supplierKind: "GOODS" });
    expect(both.id).toBe(customerPartner.id);
    const [bothRow] = await state.db.select().from(partner).where(eq(partner.id, both.id));
    expect(bothRow.type).toBe("BOTH");
    const goodsAccount = await accountByCode(companyId, "40000001");
    expect(goodsAccount?.partnerId).toBe(both.id);
    expect(bothRow.defaultAccountId).toBe(goodsAccount?.id);
    expect((await ensurePartnerSubaccount({ id: both.id, companyId }, { role: "customer" })).code).toBe("43000001");

    // Cambio de tipo de proveedor: nueva subcuenta 410 como principal; la 400 conserva su histórico.
    await state.db.update(partner).set({ supplierKind: "SERVICES" }).where(eq(partner.id, both.id));
    const services = await ensurePartnerSubaccount({ id: both.id, companyId }, { role: "supplier" });
    expect(services.code).toBe("41000001");
    const [afterChange] = await state.db.select().from(partner).where(eq(partner.id, both.id));
    expect(afterChange.defaultAccountId).toBe(services.id);
  });

  it("el alta manual de una cuenta corta crea el grupo y su subcuenta; una de 8 dígitos se enlaza con su padre", async () => {
    const companyId = "manual-accounts";
    await createCompany(companyId);
    const created = await createAccount(companyId, TENANT, USER, { code: "1000", name: "Caja", type: "ASSET" });
    expect(created).toMatchObject({ code: "10000000", name: "Caja", isPostable: true, parentCode: "1000" });
    expect(await accountByCode(companyId, "1000")).toMatchObject({ isPostable: false, parentCode: "100" });

    const direct = await createAccount(companyId, TENANT, USER, { code: "57000001", name: "Caja tienda", type: "ASSET" });
    expect(direct).toMatchObject({ isPostable: true, parentCode: "570" });
    await expect(createAccount(companyId, TENANT, USER, { code: "570000011", name: "Larga", type: "ASSET" })).rejects.toThrow("8 dígitos");
    await expect(createAccount(companyId, TENANT, USER, { code: "57000001", name: "Repetida", type: "ASSET" })).rejects.toThrow("Ya existe");
  });
});

describe("asientos automáticos con subcuentas", () => {
  const companyId = "autopost";
  let customerPartnerId = "";
  let supplierId = "";

  beforeAll(async () => {
    await createCompany(companyId);
    await applyEsSeeds({ tenantId: TENANT, companyId, actorUserId: USER, activeFiscalYearId: `${companyId}-fy2026` });
    const createdCustomer = await createCustomerWithPartner(state.db, companyId, customerInput("Pérez S.L.", "B12345674"));
    customerPartnerId = createdCustomer.partnerId as string;
    await state.db.insert(invoice).values({
      id: "inv-49",
      companyId,
      customerId: createdCustomer.id,
      number: "FA-2026/000049",
      issueDate: new Date(Date.UTC(2026, 4, 9)),
      dueDate: new Date(Date.UTC(2026, 5, 8)),
      totalAmount: "242.00",
      status: "SENT",
      issuedAt: new Date(Date.UTC(2026, 4, 9)),
    });
    const services = await accountByCode(companyId, "70500000");
    await state.db.insert(item).values({ id: "item-consulting", companyId, sku: "CONS", name: "Consultoría", salesAccountId: services?.id ?? null, isService: true });
    const supplier = await createSupplierWithPartner(state.db, companyId, { ...customerInput("Proveedor X", "B87654313"), paymentTermsDays: 30, currencyCode: "EUR", supplierKind: "SERVICES" });
    supplierId = supplier.id;
  });

  it("factura emitida: 430 del cliente con vencimiento, ventas por artículo (705) y por defecto (700), IVA en 47700000, diario VEN y número por ejercicio", async () => {
    await postSalesInvoice({
      ...actor(companyId),
      invoiceId: "inv-49",
      postedAt: new Date(Date.UTC(2026, 4, 9)),
      reference: "Factura FA-2026/000049",
      subtotal: 200,
      taxAmount: 42,
      totalAmount: 242,
      lines: [{ itemId: "item-consulting", subtotal: 150 }, { itemId: null, subtotal: 50 }],
    });
    const entry = await entryBySource(companyId, "invoice", "inv-49");
    expect(entry.number).toBe("AS-2026/000001");
    expect(entry.fiscalYearId).toBe(`${companyId}-fy2026`);
    expect(entry.journalCode).toBe("VEN");
    const lines = await entryLines(entry.id);
    expect(lines.map((line: { code: string; debit: string; credit: string }) => [line.code, line.debit, line.credit])).toEqual([
      ["43000001", "242.00", "0.00"],
      ["70500000", "0.00", "150.00"],
      ["70000000", "0.00", "50.00"],
      ["47700000", "0.00", "42.00"],
    ]);
    for (const line of lines) {
      expect(line).toMatchObject({ concept: "Fra. FA-2026/000049 · Pérez S.L.", partnerId: customerPartnerId, documentType: "invoice", documentNumber: "FA-2026/000049", documentId: "inv-49" });
    }
    expect(lines[0].dueDate?.toISOString().slice(0, 10)).toBe("2026-06-08");
    expect(lines[1].dueDate).toBeNull();
    expect(lines.map((line: { lineNumber: number }) => line.lineNumber)).toEqual([1, 2, 3, 4]);
  });

  it("cobro: banco 57200000 contra la subcuenta del cliente con concepto «Cobro fra.»", async () => {
    await state.db.insert(payment).values({ id: "pay-1", companyId, number: "RC-1", invoiceId: "inv-49", amount: "242.00", postedAt: new Date(Date.UTC(2026, 5, 1)) });
    await postCustomerPayment({ ...actor(companyId), paymentId: "pay-1", postedAt: new Date(Date.UTC(2026, 5, 1)), reference: "Cobro", amount: 242 });
    const entry = await entryBySource(companyId, "payment", "pay-1");
    expect(entry.number).toBe("AS-2026/000002");
    expect(entry.journalCode).toBe("BAN");
    const lines = await entryLines(entry.id);
    expect(lines.map((line: { code: string }) => line.code)).toEqual(["57200000", "43000001"]);
    expect(lines[1]).toMatchObject({ concept: "Cobro fra. FA-2026/000049 · Pérez S.L.", partnerId: customerPartnerId, documentNumber: "FA-2026/000049" });
  });

  it("factura recibida y pago a cuenta: gasto elegido como cuenta de grupo (629) va a 62900000 y el proveedor a su 410", async () => {
    const group629 = await accountByCode(companyId, "629");
    await state.db.insert(supplierInvoice).values({
      id: "sinv-1",
      companyId,
      supplierPartnerId: supplierId,
      number: "FR-1",
      supplierDocumentNumber: "F-77",
      issueDate: new Date(Date.UTC(2026, 4, 10)),
      dueDate: new Date(Date.UTC(2026, 5, 10)),
      totalAmount: "121.00",
    });
    await postSupplierInvoice({
      ...actor(companyId),
      supplierInvoiceId: "sinv-1",
      postedAt: new Date(Date.UTC(2026, 4, 10)),
      reference: "Factura proveedor FR-1",
      subtotal: 100,
      taxAmount: 21,
      totalAmount: 121,
      vatTreatment: "DOMESTIC",
      expenseLines: [{ accountId: group629?.id, subtotal: 100, taxAmount: 21 }],
    });
    const entry = await entryBySource(companyId, "supplierInvoice", "sinv-1");
    expect(entry.journalCode).toBe("COM");
    const lines = await entryLines(entry.id);
    expect(lines.map((line: { code: string }) => line.code)).toEqual(["62900000", "47200000", "41000002"]);
    expect(lines[2]).toMatchObject({ concept: "Fra. prov. F-77 · Proveedor X", partnerId: supplierId, documentType: "supplierInvoice" });
    expect(lines[2].dueDate?.toISOString().slice(0, 10)).toBe("2026-06-10");

    await state.db.insert(supplierPayment).values({ id: "spay-1", companyId, number: "PG-1", supplierPartnerId: supplierId, amount: "50.00", postedAt: new Date(Date.UTC(2026, 4, 20)) });
    await postSupplierPayment({ ...actor(companyId), supplierPaymentId: "spay-1", postedAt: new Date(Date.UTC(2026, 4, 20)), reference: "Pago", amount: 50 });
    const paymentLines = await entryLines((await entryBySource(companyId, "supplierPayment", "spay-1")).id);
    expect(paymentLines[0]).toMatchObject({ code: "41000002", concept: "Pago a cuenta · Proveedor X", partnerId: supplierId });
  });

  it("asiento manual: concepto por línea (hereda el anterior) y tercero opcional, en el diario general", async () => {
    const cash = await accountByCode(companyId, "57000000");
    const customerAccount = await accountByCode(companyId, "43000001");
    const created = await createJournalEntry(companyId, TENANT, USER, {
      postedAt: new Date(Date.UTC(2026, 6, 1)),
      reference: "Ajuste",
      lines: [
        { accountId: cash?.id, debit: "10", credit: "", concept: "Cobro en efectivo" },
        { accountId: customerAccount?.id, debit: "", credit: "10", partnerId: customerPartnerId },
      ],
    });
    expect(created.number).toBe("AS-2026/000005");
    const lines = await entryLines(created.id);
    expect(lines.map((line: { concept: string }) => line.concept)).toEqual(["Cobro en efectivo", "Cobro en efectivo"]);
    expect(lines[1].partnerId).toBe(customerPartnerId);
  });

  it("el cuadre con los modelos suma las subcuentas de 477, 472 y 4751", async () => {
    const balances = await fetchAccountingTaxBalances(companyId, new Date(Date.UTC(2026, 3, 1)), new Date(Date.UTC(2026, 6, 1)));
    expect(balances.outputVat).toBe(42);
    expect(balances.inputVat).toBe(21);
  });

  it("el plan contable suma en cada grupo los saldos de sus subcuentas", async () => {
    const accounts = await listAccounts(companyId);
    const find = (code: string) => accounts.find((row) => row.code === code);
    expect(find("43000001")?.balance).toBe(-10);
    expect(find("43000001")?.partnerName).toBe("Pérez S.L.");
    expect(find("430")?.balance).toBe(-10);
    expect(find("4")?.balance).toBe(find("43")!.balance + find("47")!.balance + find("41")!.balance);
    expect(find("70")?.credit).toBe(200);
  });
});

describe("regularización y cierre con subcuentas", () => {
  it("regulariza 6/7 contra 12900000 y la apertura conserva el tercero de cada subcuenta", async () => {
    const companyId = "closing";
    await createCompany(companyId);
    await applyEsSeeds({ tenantId: TENANT, companyId, actorUserId: USER, activeFiscalYearId: `${companyId}-fy2025` });
    const createdCustomer = await createCustomerWithPartner(state.db, companyId, customerInput("Cliente Cierre", "B12345674"));
    await state.db.insert(invoice).values({ id: "close-inv", companyId, customerId: createdCustomer.id, number: "FA-1", issueDate: new Date(Date.UTC(2025, 5, 1)), totalAmount: "121.00", status: "SENT", issuedAt: new Date(Date.UTC(2025, 5, 1)) });
    await postSalesInvoice({ ...actor(companyId), invoiceId: "close-inv", postedAt: new Date(Date.UTC(2025, 5, 1)), reference: "Factura FA-1", subtotal: 100, taxAmount: 21, totalAmount: 121 });

    const result = await closeFiscalYear({ ...actor(companyId), fiscalYearId: `${companyId}-fy2025` });
    const regularization = await entryLines(result.regularizationEntryId as string);
    expect(regularization.map((line: { code: string; debit: string; credit: string }) => [line.code, line.debit, line.credit])).toEqual([
      ["70000000", "100.00", "0.00"],
      ["12900000", "0.00", "100.00"],
    ]);
    expect(regularization[0].concept).toBe("Regularización ejercicio 2025");
    const [regularizationEntry] = await state.db.select({ number: journalEntry.number, journalId: journalEntry.journalId }).from(journalEntry).where(eq(journalEntry.id, result.regularizationEntryId as string));
    const [closingJournal] = await state.db.select({ code: journal.code }).from(journal).where(eq(journal.id, regularizationEntry.journalId));
    expect(closingJournal.code).toBe("CIE");

    const opening = await entryLines(result.openingEntryId as string);
    const customerLine = opening.find((line: { code: string }) => line.code === "43000001");
    expect(customerLine).toMatchObject({ debit: "121.00", partnerId: createdCustomer.partnerId, concept: "Apertura ejercicio 2026" });
  });
});

describe("reclasificación de la contabilidad antigua", () => {
  const companyId = "legacy";
  const at = (month: number, day: number, year = 2026) => new Date(Date.UTC(year, month - 1, day));
  const legacyAccounts: Record<string, string> = {};
  let customerA = "";
  let customerB = "";
  let supplier = "";

  async function legacyEntry(input: { number: string; postedAt: Date; reference: string | null; sourceType?: string; sourceId?: string; lines: Array<[string, string, string]> }) {
    const [genJournal] = await state.db.select({ id: journal.id }).from(journal).where(and(eq(journal.companyId, companyId), eq(journal.code, "GEN")));
    const [entry] = await state.db.insert(journalEntry).values({
      companyId,
      number: input.number,
      journalId: genJournal.id,
      postedAt: input.postedAt,
      reference: input.reference,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      isAutomatic: Boolean(input.sourceType),
    }).returning({ id: journalEntry.id });
    await state.db.insert(journalLine).values(input.lines.map(([code, debit, credit]) => ({ journalEntryId: entry.id, accountId: legacyAccounts[code], debit, credit })));
    return entry.id as string;
  }

  beforeAll(async () => {
    await createCompany(companyId);
    await state.db.insert(journal).values({ companyId, code: "GEN", name: "Diario general" });
    // Plan antiguo: cuentas de 3, 4 y 6 dígitos que admitían apuntes.
    const chart: Array<[string, string, "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "MIXED"]> = [
      ["4300", "Clientes", "ASSET"], ["430000", "Clientes (antigua)", "ASSET"], ["4100", "Acreedores", "LIABILITY"],
      ["700", "Ventas", "REVENUE"], ["700000", "Ventas (antigua)", "REVENUE"], ["477", "IVA repercutido", "LIABILITY"], ["477000", "IVA repercutido (antigua)", "LIABILITY"],
      ["472", "IVA soportado", "ASSET"], ["572", "Bancos", "ASSET"], ["600", "Compras", "EXPENSE"], ["629", "Otros servicios", "EXPENSE"], ["129", "Resultado", "EQUITY"],
    ];
    for (const [code, name, type] of chart) {
      const [row] = await state.db.insert(accountChart).values({ companyId, code, name, type, level: code.length, isPostable: true }).returning({ id: accountChart.id });
      legacyAccounts[code] = row.id;
    }
    const a = await createCustomerWithPartner(state.db, companyId, customerInput("Cliente A", "B12345674"));
    const b = await createCustomerWithPartner(state.db, companyId, customerInput("Cliente B", "B11111119"));
    customerA = a.partnerId as string;
    customerB = b.partnerId as string;
    // Las altas anteriores a esta fase no tenían subcuenta: se simula quitándolas.
    await state.db.update(partner).set({ defaultAccountId: null }).where(eq(partner.companyId, companyId));
    await state.db.delete(accountChart).where(and(eq(accountChart.companyId, companyId), like(accountChart.code, "430000%"), eq(accountChart.level, 8)));
    const [supplierRow] = await state.db.insert(partner).values({ companyId, number: "PR000003", type: "SUPPLIER", name: "Mayorista SL" }).returning({ id: partner.id });
    supplier = supplierRow.id;

    await state.db.insert(invoice).values([
      { id: "old-inv-1", companyId, customerId: a.id, number: "FA000001", issueDate: at(3, 1, 2025), dueDate: at(4, 1, 2025), totalAmount: "121.00", status: "SENT" },
      { id: "old-inv-2", companyId, customerId: b.id, number: "FA000002", issueDate: at(2, 1), dueDate: at(3, 1), totalAmount: "242.00", status: "SENT" },
    ]);
    await state.db.insert(payment).values({ id: "old-pay-1", companyId, number: "RC-1", invoiceId: "old-inv-1", amount: "121.00", postedAt: at(2, 15) });
    await state.db.insert(supplierInvoice).values({ id: "old-sinv-1", companyId, supplierPartnerId: supplier, number: "FR-1", supplierDocumentNumber: "M-100", issueDate: at(2, 10), dueDate: at(3, 10), totalAmount: "605.00" });
    await state.db.insert(schema.supplierInvoiceLine).values({ supplierInvoiceId: "old-sinv-1", expenseAccountId: legacyAccounts["600"], description: "Mercancía", quantity: "1", unitPrice: "500", lineTotal: "605.00" });

    // 2025: factura de A (4300 + 700 + 477), cierre y apertura con la 4300 genérica.
    await legacyEntry({ number: "AS000001", postedAt: at(3, 1, 2025), reference: "Factura FA000001", sourceType: "invoice", sourceId: "old-inv-1", lines: [["4300", "121.00", "0.00"], ["700", "0.00", "100.00"], ["477", "0.00", "21.00"]] });
    await legacyEntry({ number: "AS000002", postedAt: new Date(Date.UTC(2025, 11, 31, 23, 59, 58)), reference: "Regularización ejercicio 2025", sourceType: "fiscalYearRegularization", sourceId: `${companyId}-fy2025`, lines: [["700", "100.00", "0.00"], ["129", "0.00", "100.00"]] });
    await legacyEntry({ number: "AS000003", postedAt: new Date(Date.UTC(2025, 11, 31, 23, 59, 59)), reference: "Asiento de cierre ejercicio 2025", sourceType: "fiscalYearClosing", sourceId: `${companyId}-fy2025`, lines: [["129", "100.00", "0.00"], ["477", "21.00", "0.00"], ["4300", "0.00", "121.00"]] });
    await legacyEntry({ number: "AS000004", postedAt: at(1, 1), reference: "Asiento de apertura ejercicio 2026", sourceType: "fiscalYearOpening", sourceId: `${companyId}-fy2026`, lines: [["4300", "121.00", "0.00"], ["477", "0.00", "21.00"], ["129", "0.00", "100.00"]] });
    // 2026: factura de B en la 6 dígitos, cobro de A, cobro borrado (solo queda la referencia), factura y pago del proveedor, manual sin tercero.
    await legacyEntry({ number: "AS000005", postedAt: at(2, 1), reference: "Factura FA000002", sourceType: "invoice", sourceId: "old-inv-2", lines: [["430000", "242.00", "0.00"], ["700000", "0.00", "200.00"], ["477000", "0.00", "42.00"]] });
    await legacyEntry({ number: "AS000006", postedAt: at(2, 15), reference: "Cobro factura FA000001", sourceType: "payment", sourceId: "old-pay-1", lines: [["572", "121.00", "0.00"], ["4300", "0.00", "121.00"]] });
    await legacyEntry({ number: "AS000007", postedAt: at(2, 20), reference: "Cobro factura FA000002", sourceType: "payment", sourceId: "deleted-payment", lines: [["572", "100.00", "0.00"], ["4300", "0.00", "100.00"]] });
    await legacyEntry({ number: "AS000008", postedAt: at(2, 10), reference: "Factura proveedor FR-1", sourceType: "supplierInvoice", sourceId: "old-sinv-1", lines: [["600", "500.00", "0.00"], ["472", "105.00", "0.00"], ["4100", "0.00", "605.00"]] });
    await legacyEntry({ number: "AS000009", postedAt: at(2, 25), reference: `Pago a cuenta de proveedor ${supplier}`, sourceType: "supplierPayment", sourceId: "deleted-supplier-payment", lines: [["4100", "300.00", "0.00"], ["572", "0.00", "300.00"]] });
    await legacyEntry({ number: "AS000010", postedAt: at(3, 1), reference: null, lines: [["4300", "5.00", "0.00"], ["629", "0.00", "5.00"]] });
  });

  async function snapshotLines() {
    return state.db
      .select({ id: journalLine.id, accountId: journalLine.accountId, debit: journalLine.debit, credit: journalLine.credit })
      .from(journalLine)
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .where(eq(journalEntry.companyId, companyId))
      .orderBy(asc(journalLine.id));
  }

  it("el ensayo informa de todo y no cambia nada", async () => {
    const before = await snapshotLines();
    const [report] = await runReclassification(state.db, { apply: false, companyIds: [companyId] });
    expect(report.applied).toBe(false);
    expect(report.linesMoved.toPartner).toBeGreaterThan(0);
    expect(await snapshotLines()).toEqual(before);
    expect(await accountByCode(companyId, "43000001")).toBeUndefined();
    const audits = await state.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "accounting.reclassify")));
    expect(audits).toHaveLength(0);
  });

  it("aplica: subcuentas por tercero, cierre/apertura repartidos, sumas por grupo intactas y datos completados", async () => {
    const [report] = await runReclassification(state.db, { apply: true, companyIds: [companyId] });
    for (const group of report.groupTotals) {
      expect(group.debitAfter).toBe(group.debitBefore);
      expect(group.creditAfter).toBe(group.creditBefore);
    }
    expect(report.supplierKindsAssigned).toEqual([{ partner: "Mayorista SL", kind: "GOODS", basis: "history" }]);
    expect(report.unresolvedPartyLines).toHaveLength(1);
    expect(report.unresolvedPartyLines[0]).toMatchObject({ entry: "AS000010", account: "4300" });
    expect(report.lifecycleEntriesSplit).toBe(2);

    const balances = await state.db
      .select({ code: accountChart.code, partnerId: accountChart.partnerId, debit: journalLine.debit, credit: journalLine.credit })
      .from(journalLine)
      .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
      .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
      .where(eq(journalEntry.companyId, companyId));
    const codes = new Set<string>(balances.map((row: { code: string }) => row.code));
    // Ningún apunte queda en cuentas que no sean subcuentas de 8 dígitos.
    expect([...codes].every((code) => code.length === 8)).toBe(true);
    const net = (code: string) => balances.filter((row: { code: string }) => row.code === code).reduce((sum: number, row: { debit: string; credit: string }) => sum + Math.round(Number(row.debit) * 100) - Math.round(Number(row.credit) * 100), 0) / 100;
    expect(net("43000001")).toBe(0); // A: 121 facturado en 2025, cobrado en 2026.
    expect(net("43000002")).toBe(142); // B: 242 − 100 del cobro cuyo documento se borró (tercero por la referencia).
    expect(net("43000000")).toBe(5); // Manual sin tercero: subcuenta genérica.
    expect(net("41000003")).toBe(-305); // Proveedor de mercaderías con histórico en 410: se queda en su grupo.
    expect(net("47700000")).toBe(-63); // 21 de 2025 (vía apertura) + 42 de 2026, antes en 477 y 477000.
    expect(net("70000000")).toBe(-200);

    const [supplierRow] = await state.db.select().from(partner).where(eq(partner.id, supplier));
    expect(supplierRow.supplierKind).toBe("GOODS");
    expect((await accountByCode(companyId, "40000003"))?.id).toBe(supplierRow.defaultAccountId);

    const closingEntry = await entryBySource(companyId, "fiscalYearClosing", `${companyId}-fy2025`);
    const closing = await entryLines(closingEntry.id);
    expect(closing.find((line: { code: string }) => line.code === "43000001")).toMatchObject({ credit: "121.00", partnerId: customerA });
    const invoiceLines = await entryLines((await entryBySource(companyId, "invoice", "old-inv-2")).id);
    expect(invoiceLines[0]).toMatchObject({ code: "43000002", concept: "Fra. FA000002 · Cliente B", partnerId: customerB, documentType: "invoice", lineNumber: 1 });
    expect(invoiceLines[0].dueDate?.toISOString().slice(0, 10)).toBe("2026-03-01");

    const entries = await state.db.select({ number: journalEntry.number, fiscalYearId: journalEntry.fiscalYearId }).from(journalEntry).where(eq(journalEntry.companyId, companyId));
    expect(entries.find((row: { number: string }) => row.number === "AS000001")?.fiscalYearId).toBe(`${companyId}-fy2025`);
    expect(entries.find((row: { number: string }) => row.number === "AS000005")?.fiscalYearId).toBe(`${companyId}-fy2026`);

    const oldAccounts = await state.db.select({ code: accountChart.code, isPostable: accountChart.isPostable }).from(accountChart).where(and(eq(accountChart.companyId, companyId), inArray(accountChart.code, ["4300", "430000", "477000", "572"])));
    expect(oldAccounts.every((row: { isPostable: boolean }) => !row.isPostable)).toBe(true);
    const audits = await state.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "accounting.reclassify")));
    expect(audits).toHaveLength(1);
  });

  it("es idempotente: una segunda ejecución no cambia nada", async () => {
    const before = await snapshotLines();
    const report = await state.db.transaction((tx: never) => reclassifyCompany(tx, companyId, { apply: true }));
    expect(report.linesMoved).toEqual({ toPartner: 0, toGenericParty: 0, toCanonical: 0 });
    expect(report.lifecycleEntriesSplit).toBe(0);
    expect(report.linesBackfilled).toBe(0);
    expect(report.accountsCreated).toEqual([]);
    expect(report.accountsMadeGroups).toEqual([]);
    expect(report.entriesJournalReassigned).toBe(0);
    expect(await snapshotLines()).toEqual(before);
  });
});

describe("cambio de longitud de subcuenta", () => {
  it("renombra las subcuentas mientras no hay asientos y se bloquea con el primer asiento", async () => {
    const companyId = "resize";
    await createCompany(companyId);
    const created = await createCustomerWithPartner(state.db, companyId, customerInput("Cliente Largo", "B12345674"));
    await ensureSubaccount(companyId, "477");
    await updateSubaccountLength(companyId, TENANT, USER, 10);
    expect(await accountByCode(companyId, "4300000001")).toMatchObject({ partnerId: created.partnerId, level: 10 });
    expect(await accountByCode(companyId, "4770000000")).toMatchObject({ isPostable: true });
    expect((await ensureSubaccount(companyId, "477")).code).toBe("4770000000");

    const cash = await ensureSubaccount(companyId, "570");
    await createJournalEntry(companyId, TENANT, USER, {
      postedAt: new Date(Date.UTC(2026, 0, 10)),
      reference: "Apertura caja",
      lines: [{ accountId: cash.id, debit: "1", credit: "" }, { accountId: (await ensureSubaccount(companyId, "100")).id, debit: "", credit: "1" }],
    });
    await expect(updateSubaccountLength(companyId, TENANT, USER, 8)).rejects.toThrow("ya tiene asientos");
  });
});

describe("motor de asientos contra base de datos", () => {
  const companyId = "engine";
  let customerId = "";

  beforeAll(async () => {
    await createCompany(companyId);
    await applyEsSeeds({ tenantId: TENANT, companyId, actorUserId: USER, activeFiscalYearId: `${companyId}-fy2026` });
    await state.db.update(companySettings).set({ prorrataPct: "50" }).where(eq(companySettings.companyId, companyId));
    const created = await createCustomerWithPartner(state.db, companyId, customerInput("Cliente Motor", "B12345674"));
    customerId = created.id;
  });

  it("retención que nos practica el cliente en 47300000", async () => {
    await state.db.insert(invoice).values({ id: "eng-inv", companyId, customerId, number: "FA-9", issueDate: new Date(Date.UTC(2026, 1, 1)), totalAmount: "106.00", status: "SENT", issuedAt: new Date() });
    await postSalesInvoice({ ...actor(companyId), invoiceId: "eng-inv", postedAt: new Date(Date.UTC(2026, 1, 1)), reference: "Factura FA-9", subtotal: 100, taxAmount: 21, retentionAmount: 15, totalAmount: 106 });
    const lines = await entryLines((await entryBySource(companyId, "invoice", "eng-inv")).id);
    expect(lines.map((line: { code: string; debit: string; credit: string }) => [line.code, line.debit, line.credit])).toEqual([
      ["43000001", "106.00", "0.00"],
      ["47300000", "15.00", "0.00"],
      ["70000000", "0.00", "100.00"],
      ["47700000", "0.00", "21.00"],
    ]);
  });

  it("aplica la prorrata de la empresa: el IVA no deducible es más gasto", async () => {
    const supplier = await createSupplierWithPartner(state.db, companyId, { ...customerInput("Luz SA", "B87654313"), paymentTermsDays: 30, currencyCode: "EUR" });
    await state.db.insert(supplierInvoice).values({ id: "eng-sinv", companyId, supplierPartnerId: supplier.id, number: "FR-9", issueDate: new Date(Date.UTC(2026, 1, 2)), totalAmount: "121.00" });
    const expense = await ensureSubaccount(companyId, "628");
    await postSupplierInvoice({ ...actor(companyId), supplierInvoiceId: "eng-sinv", postedAt: new Date(Date.UTC(2026, 1, 2)), reference: "Luz", subtotal: 100, taxAmount: 21, totalAmount: 121, vatTreatment: "DOMESTIC", expenseLines: [{ accountId: expense.id, subtotal: 100, taxAmount: 21 }] });
    const lines = await entryLines((await entryBySource(companyId, "supplierInvoice", "eng-sinv")).id);
    // Empresa «both»: proveedor de mercaderías por defecto (400).
    expect(lines.map((line: { code: string; debit: string; credit: string }) => [line.code, line.debit, line.credit])).toEqual([
      ["62800000", "110.50", "0.00"],
      ["47200000", "10.50", "0.00"],
      ["40000002", "0.00", "121.00"],
    ]);
  });

  it("cobro con forma de pago vinculada a un banco: subcuenta del banco; en efectivo: caja 57000000; movimiento sin identificar a 555", async () => {
    const bankLedger = await createAccount(companyId, TENANT, USER, { code: "57200001", name: "Banco Uno", type: "ASSET" });
    const [bank] = await state.db.insert(schema.bankAccount).values({ companyId, iban: "ES7620770024003102575766", bankName: "Banco Uno", accountId: bankLedger.id }).returning();
    const [linked] = await state.db.insert(schema.paymentMethod).values({ companyId, code: "TR", name: "Transferencia", bankAccountId: bank.id }).returning();
    const [cash] = await state.db.insert(schema.paymentMethod).values({ companyId, code: "EF", name: "Efectivo", type: "CASH" }).returning();
    await state.db.insert(payment).values([
      { id: "eng-pay-1", companyId, number: "RC-9", invoiceId: "eng-inv", amount: "50.00", postedAt: new Date(Date.UTC(2026, 1, 3)) },
      { id: "eng-pay-2", companyId, number: "RC-10", invoiceId: "eng-inv", amount: "56.00", postedAt: new Date(Date.UTC(2026, 1, 4)) },
    ]);
    await postCustomerPayment({ ...actor(companyId), paymentId: "eng-pay-1", postedAt: new Date(Date.UTC(2026, 1, 3)), reference: "Cobro", amount: 50, paymentMethodId: linked.id });
    await postCustomerPayment({ ...actor(companyId), paymentId: "eng-pay-2", postedAt: new Date(Date.UTC(2026, 1, 4)), reference: "Cobro", amount: 56, paymentMethodId: cash.id });
    expect((await entryLines((await entryBySource(companyId, "payment", "eng-pay-1")).id))[0].code).toBe("57200001");
    expect((await entryLines((await entryBySource(companyId, "payment", "eng-pay-2")).id))[0].code).toBe("57000000");

    const [movement] = await state.db.insert(schema.bankTransaction).values({ bankAccountId: bank.id, postedAt: new Date(Date.UTC(2026, 1, 5)), amount: "-3.50", description: "Comisión mantenimiento" }).returning();
    await postBankTransaction({ ...actor(companyId), bankTransactionId: movement.id, bankAccountId: bank.id, postedAt: new Date(Date.UTC(2026, 1, 5)), reference: "Comisión", amount: -3.5 });
    const movementLines = await entryLines((await entryBySource(companyId, "bankTransaction", movement.id)).id);
    expect(movementLines.map((line: { code: string; debit: string; credit: string }) => [line.code, line.debit, line.credit])).toEqual([
      ["55500000", "3.50", "0.00"],
      ["57200001", "0.00", "3.50"],
    ]);
    expect(movementLines[0]).toMatchObject({ concept: "Mov. banco · Comisión mantenimiento", documentType: "bankTransaction" });
  });

  it("una subcuenta 572 por banco y migración de los cobros de la 572 genérica (efectivo a caja)", async () => {
    const bankCo = "banks";
    await createCompany(bankCo);
    await applyEsSeeds({ tenantId: TENANT, companyId: bankCo, actorUserId: USER, activeFiscalYearId: `${bankCo}-fy2026` });
    const client = await createCustomerWithPartner(state.db, bankCo, customerInput("Cliente Bancos", "B12345674"));
    await state.db.insert(invoice).values({ id: "bk-inv", companyId: bankCo, customerId: client.id, number: "FA-1", issueDate: new Date(Date.UTC(2026, 1, 1)), totalAmount: "300.00", status: "SENT", issuedAt: new Date() });

    // Datos anteriores: bancos sin subcuenta y cobros contabilizados en la 57200000 genérica.
    const [bbva] = await state.db.insert(schema.bankAccount).values({ companyId: bankCo, iban: "ES7620770024003102575766", bankName: "BBVA" }).returning();
    const [transfer] = await state.db.insert(schema.paymentMethod).values({ companyId: bankCo, code: "TR-BBVA", name: "Transferencia · BBVA", bankAccountId: bbva.id }).returning();
    const [cash] = await state.db.insert(schema.paymentMethod).values({ companyId: bankCo, code: "CAJA", name: "Caja", type: "CASH" }).returning();
    await state.db.insert(payment).values([
      { id: "bk-pay-1", companyId: bankCo, number: "CO-1", invoiceId: "bk-inv", paymentMethodId: transfer.id, amount: "100.00", postedAt: new Date(Date.UTC(2026, 1, 3)) },
      { id: "bk-pay-2", companyId: bankCo, number: "CO-2", invoiceId: "bk-inv", paymentMethodId: cash.id, amount: "20.00", postedAt: new Date(Date.UTC(2026, 1, 4)) },
    ]);
    await postCustomerPayment({ ...actor(bankCo), paymentId: "bk-pay-1", postedAt: new Date(Date.UTC(2026, 1, 3)), reference: "Cobro", amount: 100, paymentMethodId: transfer.id });
    await postCustomerPayment({ ...actor(bankCo), paymentId: "bk-pay-2", postedAt: new Date(Date.UTC(2026, 1, 4)), reference: "Cobro", amount: 20 });
    expect((await entryLines((await entryBySource(bankCo, "payment", "bk-pay-1")).id))[0].code).toBe("57200000");
    expect((await entryLines((await entryBySource(bankCo, "payment", "bk-pay-2")).id))[0].code).toBe("57200000");

    // Un banco nuevo estrena su propia subcuenta.
    const caixa = await createBankAccount(bankCo, TENANT, USER, { iban: "ES9121000418450200051332", bankName: "La Caixa" });
    expect((await state.db.select().from(accountChart).where(eq(accountChart.id, caixa.accountId as string)))[0]).toMatchObject({ code: "57200001", name: "La Caixa ···1332" });

    const dryRun = await runBankSubaccountAssignment(state.db, { apply: false, companyId: bankCo });
    expect(dryRun.movedLines).toHaveLength(2);
    expect((await entryLines((await entryBySource(bankCo, "payment", "bk-pay-1")).id))[0].code).toBe("57200000");

    const applied = await runBankSubaccountAssignment(state.db, { apply: true, companyId: bankCo });
    expect(applied.banks).toEqual([{ bankName: "BBVA", iban: bbva.iban, from: null, to: "57200002" }]);
    expect(applied.cashPaymentMethodCreated).toBe(false);
    expect((await entryLines((await entryBySource(bankCo, "payment", "bk-pay-1")).id))[0].code).toBe("57200002");
    expect((await entryLines((await entryBySource(bankCo, "payment", "bk-pay-2")).id))[0].code).toBe("57000000");
    expect(applied.remainingGenericLines).toBe(0);

    const again = await runBankSubaccountAssignment(state.db, { apply: true, companyId: bankCo });
    expect(again.banks).toEqual([]);
    expect(again.movedLines).toEqual([]);
  });

  it("pasarela Stripe: cobro por el total en Stripe, traspaso al banco y comisión descontada a 626", async () => {
    const co = "gateway";
    await createCompany(co);
    await applyEsSeeds({ tenantId: TENANT, companyId: co, actorUserId: USER, activeFiscalYearId: `${co}-fy2026` });
    const client = await createCustomerWithPartner(state.db, co, customerInput("Cliente Stripe", "B12345674"));
    const treasuryActor = { tenantId: TENANT, companyId: co, actorUserId: USER, activeFiscalYearId: `${co}-fy2026` };
    const balanceOf = async (code: string) => {
      const [row] = await state.db
        .select({ net: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)::text` })
        .from(journalLine)
        .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
        .where(and(eq(accountChart.companyId, co), eq(accountChart.code, code)));
      return Number(row.net);
    };

    const bbva = await createBankAccount(co, TENANT, USER, { iban: "ES7620770024003102575766", bankName: "BBVA" });
    const [stripeMethod] = await state.db.insert(schema.paymentMethod).values({ companyId: co, code: "STRIPE", name: "Stripe", type: "CARD" }).returning();
    const stripe = await createBankAccount(co, TENANT, USER, { kind: "PAYMENT_PROVIDER", bankName: "Stripe", paymentMethodId: stripeMethod.id });
    expect(stripe).toMatchObject({ kind: "PAYMENT_PROVIDER", iban: null });
    expect((await state.db.select().from(accountChart).where(eq(accountChart.id, stripe.accountId as string)))[0]).toMatchObject({ code: "57200002", name: "Stripe" });
    expect((await state.db.select().from(schema.paymentMethod).where(eq(schema.paymentMethod.id, stripeMethod.id)))[0].bankAccountId).toBe(stripe.id);
    // La pasarela no crea otra forma de pago: usa «Stripe».
    expect(await state.db.select().from(schema.paymentMethod).where(eq(schema.paymentMethod.bankAccountId, stripe.id))).toHaveLength(1);

    // 1. Cobro de la factura de 100 € con Stripe: por el total, en la subcuenta de Stripe.
    await state.db.insert(invoice).values({ id: "gw-inv-1", companyId: co, customerId: client.id, number: "FA-G1", issueDate: new Date(Date.UTC(2026, 2, 1)), totalAmount: "100.00", status: "SENT", issuedAt: new Date() });
    await postSalesInvoice({ ...actor(co), invoiceId: "gw-inv-1", postedAt: new Date(Date.UTC(2026, 2, 1)), reference: "FA-G1", subtotal: 82.64, taxAmount: 17.36, totalAmount: 100 });
    await state.db.insert(payment).values({ id: "gw-pay-1", companyId: co, number: "CO-G1", invoiceId: "gw-inv-1", paymentMethodId: stripeMethod.id, amount: "100.00", postedAt: new Date(Date.UTC(2026, 2, 2)) });
    await postCustomerPayment({ ...actor(co), paymentId: "gw-pay-1", postedAt: new Date(Date.UTC(2026, 2, 2)), reference: "Cobro FA-G1", amount: 100, paymentMethodId: stripeMethod.id });
    expect(await balanceOf("57200002")).toBe(100);

    // 2. Stripe ingresa 98,25 € en el BBVA: traspaso Stripe → BBVA. Quedan 1,75 € de comisión en Stripe.
    const payout = await state.db.transaction((tx: DbClient) => recordBankTransaction(co, TENANT, USER, { bankAccountId: bbva.id, amount: "98.25", description: "STRIPE PAYMENTS EUROPE", postedAt: new Date(Date.UTC(2026, 2, 5)) }, tx));
    const workbench = await getReconciliationWorkbench(co);
    const proposal = workbench.movements.find((movement) => movement.id === payout.id)?.suggestions[0];
    expect(proposal).toMatchObject({ kind: "TRANSFER", title: "Traspaso desde Stripe" });
    await applyAllocations(treasuryActor, { transactionId: payout.id, allocations: proposal!.allocations });
    expect(await balanceOf("57200001")).toBe(98.25);
    expect(await balanceOf("57200002")).toBeCloseTo(1.75, 2);
    expect(await balanceOf("55500000")).toBe(0);

    // 3. Cobro directo al banco con la comisión descontada (TPV): factura de 50 €, ingreso de 48,80 €.
    await state.db.insert(invoice).values({ id: "gw-inv-2", companyId: co, customerId: client.id, number: "FA-G2", issueDate: new Date(Date.UTC(2026, 2, 6)), totalAmount: "50.00", status: "SENT", issuedAt: new Date() });
    await postSalesInvoice({ ...actor(co), invoiceId: "gw-inv-2", postedAt: new Date(Date.UTC(2026, 2, 6)), reference: "FA-G2", subtotal: 41.32, taxAmount: 8.68, totalAmount: 50 });
    const tpv = await state.db.transaction((tx: DbClient) => recordBankTransaction(co, TENANT, USER, { bankAccountId: bbva.id, amount: "48.80", description: "ABONO TPV FA-G2", postedAt: new Date(Date.UTC(2026, 2, 7)) }, tx));
    const feeProposal = (await getReconciliationWorkbench(co)).movements.find((movement) => movement.id === tpv.id)?.suggestions.find((suggestion) => suggestion.kind === "FEE");
    expect(feeProposal?.allocations.map((allocation) => [allocation.type, allocation.amount])).toEqual([["CUSTOMER_INVOICE", 50], ["ACCOUNT", -1.2]]);
    await applyAllocations(treasuryActor, { transactionId: tpv.id, allocations: feeProposal!.allocations });
    expect(await balanceOf("57200001")).toBeCloseTo(147.05, 2);
    expect(await balanceOf("62600000")).toBeCloseTo(1.2, 2);
    expect((await state.db.select({ status: invoice.paymentStatus }).from(invoice).where(eq(invoice.id, "gw-inv-2")))[0].status).toBe("PAID");
  });

  it("impuestos: el plan no duplica los que ya tienes con otro nombre y los duplicados se fusionan", async () => {
    const co = "taxdup";
    await createCompany(co);
    // Impuestos creados a mano antes de aplicar el plan español.
    await state.db.insert(schema.tax).values([
      { companyId: co, name: "IVA", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: true },
      { companyId: co, name: "IRPF 15%", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT" },
    ]);
    await applyEsSeeds({ tenantId: TENANT, companyId: co, actorUserId: USER, activeFiscalYearId: `${co}-fy2026` });
    const names = async () => (await state.db.select({ name: schema.tax.name }).from(schema.tax).where(eq(schema.tax.companyId, co))).map((row: { name: string }) => row.name).sort();
    const seeded = await names();
    expect(seeded).toContain("IVA");
    expect(seeded).toContain("IRPF 15%");
    expect(seeded).not.toContain("IVA general 21%");
    expect(seeded).not.toContain("Retención IRPF 15%");
    expect(seeded).toContain("IVA reducido 10%");
    expect(seeded).toContain("Retención IRPF 7%");

    // Datos antiguos: duplicados ya creados, con un artículo que usa uno de ellos.
    const [dupVat] = await state.db.insert(schema.tax).values({ companyId: co, name: "IVA general 21%", rate: "21.000", kind: "VAT", operation: "ADD" }).returning();
    const [dupIrpf] = await state.db.insert(schema.tax).values({ companyId: co, name: "Retencion IRPF 15%", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT" }).returning();
    const [article] = await state.db.insert(item).values({ companyId: co, sku: "SRV-1", name: "Servicio", defaultTaxId: dupVat.id }).returning();
    // El duplicado de IRPF es el que usan las facturas: se conserva él (con su nombre corregido).
    const client = await createCustomerWithPartner(state.db, co, customerInput("Cliente Impuestos", "B12345674"));
    await state.db.insert(invoice).values({ id: "taxdup-inv", companyId: co, customerId: client.id, number: "FA-T1", issueDate: new Date(Date.UTC(2026, 3, 1)), totalAmount: "106.00", status: "SENT", issuedAt: new Date() });
    const [invoiceRow] = await state.db.insert(schema.invoiceLine).values({ invoiceId: "taxdup-inv", description: "Servicio", quantity: "1", unitPrice: "100.00", lineTotal: "106.00" }).returning();
    await state.db.insert(schema.invoiceLineTax).values({ invoiceLineId: invoiceRow.id, taxId: dupIrpf.id, name: "Retencion IRPF 15%", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT", baseAmount: "100.00", amount: "15.00" });

    const report = await state.db.transaction((tx: DbClient) => dedupeCompanyTaxes(tx, co));
    expect(report.merges).toHaveLength(2);
    const after = await names();
    expect(after.filter((name: string) => name.includes("21"))).toEqual(["IVA general 21%"]);
    expect(after.filter((name: string) => name.includes("15"))).toEqual(["Retención IRPF 15%"]);
    const [kept] = await state.db.select().from(schema.tax).where(and(eq(schema.tax.companyId, co), eq(schema.tax.name, "IVA general 21%")));
    expect(kept.isDefault).toBe(true);
    expect((await state.db.select().from(item).where(eq(item.id, article.id)))[0].defaultTaxId).toBe(kept.id);
    const irpfMerge = report.merges.find((merge: { kept: { finalName: string } }) => merge.kept.finalName === "Retención IRPF 15%");
    expect(irpfMerge?.kept.id).toBe(dupIrpf.id);
    expect(irpfMerge?.merged).toEqual([expect.objectContaining({ name: "IRPF 15%", invoiceLines: 0 })]);
    // La línea de la factura conserva su copia del nombre; solo su referencia apunta al impuesto que queda.
    expect((await state.db.select().from(schema.invoiceLineTax).where(eq(schema.invoiceLineTax.invoiceLineId, invoiceRow.id)))[0]).toMatchObject({ taxId: dupIrpf.id, name: "Retencion IRPF 15%" });
    // Idempotente.
    expect((await state.db.transaction((tx: DbClient) => dedupeCompanyTaxes(tx, co))).merges).toEqual([]);
  });

  it("emitir no exige los nombres de la plantilla ni recrea los impuestos borrados: basta un IVA activo", async () => {
    const co = "taxready";
    await createCompany(co);
    await applyEsSeeds({ tenantId: TENANT, companyId: co, actorUserId: USER, activeFiscalYearId: `${co}-fy2026` });
    const statusInput = { companyId: co, fiscalYearId: `${co}-fy2026`, countryCode: "ES" };
    expect((await getCompanyDefaultsStatus(statusInput)).ready).toBe(true);

    // Lo que hizo el usuario: renombrar a «IVA» e «IRPF» y borrar los impuestos que no usa.
    await state.db.update(schema.tax).set({ name: "IVA" }).where(and(eq(schema.tax.companyId, co), eq(schema.tax.name, "IVA general 21%")));
    await state.db.update(schema.tax).set({ name: "IRPF" }).where(and(eq(schema.tax.companyId, co), eq(schema.tax.name, "Retención IRPF 15%")));
    await state.db.delete(schema.tax).where(and(eq(schema.tax.companyId, co), inArray(schema.tax.name, ["IVA reducido 10%", "IVA superreducido 4%", "Retención IRPF 7%"])));
    const renamed = await getCompanyDefaultsStatus(statusInput);
    expect(renamed.ready).toBe(true);
    const taxItems = renamed.groups.find((group) => group.key === "taxes")!.items;
    expect(taxItems.find((entry) => entry.label === "IVA general 21%")?.created).toBe(true);
    expect(taxItems.find((entry) => entry.label === "IVA superreducido 4%")?.created).toBe(false);

    // Sin ningún IVA activo sí falta configuración.
    await state.db.update(schema.tax).set({ isActive: false }).where(and(eq(schema.tax.companyId, co), eq(schema.tax.kind, "VAT")));
    expect((await getCompanyDefaultsStatus(statusInput)).ready).toBe(false);
  });

  it("crea la forma de pago «Efectivo» si la empresa no tiene ninguna en efectivo", async () => {
    await createCompany("cash-co");
    expect(await ensureCashPaymentMethod(state.db, "cash-co")).toMatchObject({ created: true });
    expect(await ensureCashPaymentMethod(state.db, "cash-co")).toMatchObject({ created: false });
    const methods = await state.db.select().from(schema.paymentMethod).where(eq(schema.paymentMethod.companyId, "cash-co"));
    expect(methods).toEqual([expect.objectContaining({ code: "EFECTIVO", name: "Efectivo", type: "CASH", bankAccountId: null })]);
  });

  it("sin plan contable ni plantilla del país falla con un mensaje claro", async () => {
    await state.db.insert(company).values({ id: "no-chart", tenantId: TENANT, name: "Sin plan", countryCode: "FR" });
    await state.db.insert(invoice).values({ id: "fr-inv", companyId: "no-chart", customerId, number: "F-1", issueDate: new Date(), totalAmount: "10.00", status: "SENT" });
    await expect(postSalesInvoice({ ...actor("no-chart"), invoiceId: "fr-inv", postedAt: new Date(), reference: "F-1", subtotal: 10, taxAmount: 0, totalAmount: 10 })).rejects.toThrow("No existe la cuenta 4300");
  });
});
