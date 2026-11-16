import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Paquetes fiscales por país contra Postgres real (PGlite): una empresa de fuera de España recibe
 * su plantilla (tipos de IVA del país + plan genérico por grupos) y contabiliza igual que una
 * española; cambiar de país adopta el paquete nuevo mientras no haya facturas emitidas.
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
import { accountChart, company, companySettings, fiscalYear, invoice, journalEntry, journalLine, tax, tenant, user } from "@/db/schema";
import { postSalesInvoice, postSupplierInvoice } from "@/server/accounting/auto-post";
import { changeCompanyCountry, currentCompanyTerritory, syncCompanyTaxTerritory } from "@/server/company/country";
import { getCompanyDefaultsStatus } from "@/server/company/defaults";
import { getCompanyFiscalContext } from "@/server/company/fiscal-context";
import { createCustomerWithPartner } from "@/server/customers/service";
import { applyCompanyTemplate } from "@/server/seeds/apply";
import { createSupplierWithPartner } from "@/server/suppliers/service";
import { getVerifactuSettings } from "@/server/verifactu/settings";
import { calculateTaxSummary, parseTaxSummaryPeriod } from "@/server/fiscal/tax-summary";

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

async function createCompany(id: string, countryCode: string) {
  await state.db.insert(company).values({ id, tenantId: TENANT, name: `Empresa ${id}`, countryCode });
  await state.db.insert(companySettings).values({ companyId: id });
  await state.db.insert(fiscalYear).values({ id: `${id}-fy`, companyId: id, code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) });
}

async function activeTaxes(companyId: string) {
  return state.db
    .select({ name: tax.name, rate: tax.rate, kind: tax.kind, isDefault: tax.isDefault })
    .from(tax)
    .where(and(eq(tax.companyId, companyId), eq(tax.isActive, true)))
    .orderBy(asc(tax.name)) as Promise<Array<{ name: string; rate: string; kind: string; isDefault: boolean }>>;
}

async function entryLines(companyId: string, sourceId: string) {
  return state.db
    .select({ code: accountChart.code, debit: journalLine.debit, credit: journalLine.credit })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(eq(journalEntry.companyId, companyId), eq(journalEntry.sourceId, sourceId)))
    .orderBy(asc(journalLine.lineNumber)) as Promise<Array<{ code: string; debit: string; credit: string }>>;
}

const partyInput = (name: string, taxId: string, countryCode: string) => ({
  name,
  taxId,
  address: "1 rue de Rivoli",
  postalCode: "75001",
  city: "Paris",
  province: "",
  countryCode,
});

describe("empresa francesa (paquete básico)", () => {
  const companyId = "fr-co";

  beforeAll(async () => {
    await createCompany(companyId, "FR");
    await applyCompanyTemplate({ tenantId: TENANT, companyId, actorUserId: USER, activeFiscalYearId: `${companyId}-fy`, countryCode: "FR" });
  });

  it("recibe los tipos de TVA de Francia y queda lista para facturar", async () => {
    const taxes = await activeTaxes(companyId);
    expect(taxes.map((entry) => [entry.name, Number(entry.rate), entry.isDefault])).toEqual([
      ["TVA general 20%", 20, true],
      ["TVA reducido 10%", 10, false],
      ["TVA reducido 5,5%", 5.5, false],
      ["TVA superreducido 2,1%", 2.1, false],
    ]);
    const status = await getCompanyDefaultsStatus({ companyId, fiscalYearId: `${companyId}-fy`, countryCode: "FR" });
    expect(status.preset).toBe("GENERIC");
    expect(status.ready).toBe(true);
    expect((await getCompanyFiscalContext(companyId)).profile.level).toBe("basic");
    expect((await getVerifactuSettings(state.db, companyId)).applies).toBe(false);
  });

  it("contabiliza ventas y compras con el plan genérico (430/700/477 y 400/600/472)", async () => {
    const customer = await createCustomerWithPartner(state.db, companyId, partyInput("Client SARL", "FR40303265045", "FR"));
    await state.db.insert(invoice).values({ id: "fr-inv", companyId, customerId: customer.id, number: "F-1", issueDate: new Date(Date.UTC(2026, 3, 1)), totalAmount: "120.00", status: "SENT", issuedAt: new Date(Date.UTC(2026, 3, 1)) });
    await postSalesInvoice({ tenantId: TENANT, companyId, actorUserId: USER, invoiceId: "fr-inv", postedAt: new Date(Date.UTC(2026, 3, 1)), reference: "Facture F-1", subtotal: 100, taxAmount: 20, totalAmount: 120 });
    const sale = await entryLines(companyId, "fr-inv");
    expect(sale.map((line) => [line.code.slice(0, 3), Number(line.debit), Number(line.credit)])).toEqual([
      ["430", 120, 0],
      ["700", 0, 100],
      ["477", 0, 20],
    ]);

    const supplier = await createSupplierWithPartner(state.db, companyId, { ...partyInput("Fournisseur", "FR82542065479", "FR"), paymentTermsDays: 30, currencyCode: "EUR", supplierKind: "GOODS" });
    await state.db.insert(schema.supplierInvoice).values({ id: "fr-bill", companyId, supplierPartnerId: supplier.id, number: "BILL-1", issueDate: new Date(Date.UTC(2026, 3, 2)), accountingDate: new Date(Date.UTC(2026, 3, 2)), totalAmount: "60.00", status: "POSTED", vatTreatment: "DOMESTIC" });
    await postSupplierInvoice({ tenantId: TENANT, companyId, actorUserId: USER, supplierInvoiceId: "fr-bill", postedAt: new Date(Date.UTC(2026, 3, 2)), reference: "BILL-1", subtotal: 50, taxAmount: 10, totalAmount: 60 });
    const purchase = await entryLines(companyId, "fr-bill");
    expect(purchase.map((line) => [line.code.slice(0, 3), Number(line.debit), Number(line.credit)])).toEqual([
      ["600", 50, 0],
      ["472", 10, 0],
      ["400", 0, 60],
    ]);
  });
});

describe("resumen de impuestos (países sin modelos oficiales)", () => {
  it("calcula TVA devengada − deducible del trimestre desde las facturas contabilizadas", async () => {
    const summary = await calculateTaxSummary("fr-co", parseTaxSummaryPeriod("2026-Q2")!, "FR");
    expect(summary.period.key).toBe("2026-Q2");
    expect(summary.result).toBe(summary.accrued - summary.deductible);
  }, 30_000);
});

describe("cambio de país", () => {
  it("España → Portugal: moneda, zona horaria e impuestos del nuevo país; los españoles quedan inactivos", async () => {
    const companyId = "es-to-pt";
    await createCompany(companyId, "ES");
    await applyCompanyTemplate({ tenantId: TENANT, companyId, actorUserId: USER, activeFiscalYearId: `${companyId}-fy`, countryCode: "ES" });

    const changed = await state.db.transaction((tx: never) => changeCompanyCountry({ tenantId: TENANT, companyId, fiscalYearId: `${companyId}-fy`, actorUserId: USER, countryCode: "PT" }, tx));
    expect(changed).toBe(true);
    const [row] = await state.db.select({ countryCode: company.countryCode, currency: company.baseCurrencyCode, timezone: company.timezone }).from(company).where(eq(company.id, companyId));
    expect(row).toEqual({ countryCode: "PT", currency: "EUR", timezone: "Europe/Lisbon" });
    const taxes = await activeTaxes(companyId);
    expect(taxes.map((entry) => Number(entry.rate)).sort((a, b) => b - a)).toEqual([23, 13, 6]);
    expect(taxes.find((entry) => entry.isDefault)?.rate).toBe("23.000");
    // Sin cambios si el país es el mismo.
    expect(await changeCompanyCountry({ tenantId: TENANT, companyId, fiscalYearId: `${companyId}-fy`, actorUserId: USER, countryCode: "PT" })).toBe(false);
  });

  it("no se permite con facturas emitidas", async () => {
    const companyId = "es-locked";
    await createCompany(companyId, "ES");
    const customer = await createCustomerWithPartner(state.db, companyId, partyInput("Cliente", "B12345674", "ES"));
    await state.db.insert(invoice).values({ id: "locked-inv", companyId, customerId: customer.id, number: "FA-1", issueDate: new Date(), totalAmount: "10.00", status: "SENT", issuedAt: new Date() });
    await expect(changeCompanyCountry({ tenantId: TENANT, companyId, fiscalYearId: `${companyId}-fy`, actorUserId: USER, countryCode: "FR" })).rejects.toThrow("facturas emitidas");
  });
});

describe("Canarias, Ceuta y Melilla", () => {
  it("una empresa con domicilio en Tenerife recibe el IGIC al aplicar la plantilla de España", async () => {
    const companyId = "es-tenerife";
    await createCompany(companyId, "ES");
    await state.db.update(company).set({ postalCode: "38001", province: "Santa Cruz de Tenerife" }).where(eq(company.id, companyId));
    await applyCompanyTemplate({ tenantId: TENANT, companyId, actorUserId: USER, activeFiscalYearId: `${companyId}-fy`, countryCode: "ES" });
    const taxes = await activeTaxes(companyId);
    expect(taxes.filter((entry) => entry.kind === "VAT").map((entry) => entry.name).sort()).toEqual(["IGIC especial incrementado 15%", "IGIC general 7%", "IGIC incrementado 9,5%", "IGIC reducido 3%", "IGIC tipo cero 0%"]);
    expect(taxes.find((entry) => entry.isDefault)?.name).toBe("IGIC general 7%");
    expect(taxes.some((entry) => entry.kind === "SURCHARGE")).toBe(false);
    expect(taxes.filter((entry) => entry.kind === "WITHHOLDING")).toHaveLength(3);
    const context = await getCompanyFiscalContext(companyId);
    expect(context.homeCountry).toBe("ES-CN");
    expect(context.profile.features.vatReturns).toBe(false);
    const status = await getCompanyDefaultsStatus({ companyId, fiscalYearId: `${companyId}-fy`, countryCode: "ES" });
    expect(status.ready).toBe(true);
    expect(status.groups.find((group) => group.key === "taxes")?.missingCount).toBe(0);
  });

  it("traslado de Madrid a Ceuta: el IVA pasa a IPSI (mismo tipo renombrado) y se desactiva el resto", async () => {
    const companyId = "es-to-ceuta";
    await createCompany(companyId, "ES");
    await state.db.update(company).set({ postalCode: "28013", province: "Madrid" }).where(eq(company.id, companyId));
    await applyCompanyTemplate({ tenantId: TENANT, companyId, actorUserId: USER, activeFiscalYearId: `${companyId}-fy`, countryCode: "ES" });
    const actorInput = { tenantId: TENANT, companyId, fiscalYearId: `${companyId}-fy`, actorUserId: USER };
    expect(await currentCompanyTerritory(actorInput)).toBe("ES");

    await state.db.update(company).set({ postalCode: "51001", province: "Ceuta" }).where(eq(company.id, companyId));
    const changed = await state.db.transaction((tx: never) => syncCompanyTaxTerritory({ ...actorInput, previousTerritory: "ES" }, tx));
    expect(changed).toBe(true);
    const taxes = await activeTaxes(companyId);
    const indirect = taxes.filter((entry) => entry.kind === "VAT");
    expect(indirect.every((entry) => entry.name.startsWith("IPSI"))).toBe(true);
    expect(indirect.map((entry) => Number(entry.rate)).sort((a, b) => b - a)).toEqual([10, 8, 6, 4, 3, 2, 1, 0.5]);
    // IPSI: el tipo depende de la actividad, no hay uno por defecto.
    expect(indirect.some((entry) => entry.isDefault)).toBe(false);
    expect(taxes.some((entry) => entry.kind === "SURCHARGE")).toBe(false);
    // Sin cambios si el territorio es el mismo.
    expect(await syncCompanyTaxTerritory({ ...actorInput, previousTerritory: "ES-CE" })).toBe(false);
  });
});
