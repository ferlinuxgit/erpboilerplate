import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Catálogo de impuestos contra Postgres real (PGlite): una empresa nueva solo usa los habituales;
 * los demás se activan con un clic; una empresa antigua con impuestos creados a mano («IVA»,
 * «IRPF») los ve reconocidos en el catálogo sin duplicarlos.
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
import { company, companySettings, fiscalYear, tax, tenant, user } from "@/db/schema";
import { getCompanySalesVatTreatments, saveCompanySalesVatTreatments } from "@/server/invoices/vat-treatments";
import { applyCompanyTemplate } from "@/server/seeds/apply";
import { listCompanyTaxCatalog, setCompanyCatalogTaxInUse } from "@/server/taxes/catalog";

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

async function createCompany(id: string) {
  await state.db.insert(company).values({ id, tenantId: TENANT, name: `Empresa ${id}`, countryCode: "ES", postalCode: "30310", province: "Murcia" });
  await state.db.insert(companySettings).values({ companyId: id });
  await state.db.insert(fiscalYear).values({ id: `${id}-fy`, companyId: id, code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) });
}

async function activeNames(companyId: string) {
  const rows = await state.db.select({ name: tax.name }).from(tax).where(and(eq(tax.companyId, companyId), eq(tax.isActive, true))).orderBy(asc(tax.name));
  return rows.map((row: { name: string }) => row.name);
}

const inUseOf = async (companyId: string) => (await listCompanyTaxCatalog(companyId)).entries.filter((entry) => entry.inUse).map((entry) => entry.name);

describe("catálogo de impuestos", () => {
  it("una empresa nueva solo usa los habituales; el resto está en el catálogo", async () => {
    await createCompany("nueva");
    await applyCompanyTemplate({ tenantId: TENANT, companyId: "nueva", actorUserId: USER, activeFiscalYearId: "nueva-fy", countryCode: "ES" });
    expect(await activeNames("nueva")).toEqual(["IVA general 21%", "IVA reducido 10%", "IVA superreducido 4%", "Retención IRPF 15%"]);
    const { entries, custom, territory } = await listCompanyTaxCatalog("nueva");
    expect(territory).toBe("ES");
    expect(custom).toEqual([]);
    expect(entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(["Recargo de equivalencia 5,2%", "Retención IRPF 7%", "Retención módulos 1%", "Retención administradores 35%"]));
    expect(entries.find((entry) => entry.name === "Retención IRPF 7%")).toMatchObject({ inUse: false, description: expect.stringContaining("inicio de actividad") });
  });

  it("activar y desactivar un impuesto del catálogo", async () => {
    const irpf7 = (await listCompanyTaxCatalog("nueva")).entries.find((entry) => entry.name === "Retención IRPF 7%")!;
    await setCompanyCatalogTaxInUse("nueva", irpf7.code, true);
    expect(await activeNames("nueva")).toContain("Retención IRPF 7%");
    await setCompanyCatalogTaxInUse("nueva", irpf7.code, false);
    expect(await activeNames("nueva")).not.toContain("Retención IRPF 7%");
    // Un impuesto que no está en el catálogo del territorio no se puede activar así.
    expect(await setCompanyCatalogTaxInUse("nueva", "VAT|99.000|ADD", true)).toBeNull();
  });

  it("reconoce los impuestos creados a mano sin duplicarlos y crea los que faltan con su nombre oficial", async () => {
    await createCompany("antigua");
    await state.db.insert(tax).values([
      { companyId: "antigua", name: "IVA", rate: "21.000", kind: "VAT", operation: "ADD", isDefault: true },
      { companyId: "antigua", name: "IRPF", rate: "15.000", kind: "WITHHOLDING", operation: "SUBTRACT" },
      { companyId: "antigua", name: "Ecotasa", rate: "2.000", kind: "OTHER", operation: "ADD" },
    ]);
    const { entries, custom } = await listCompanyTaxCatalog("antigua");
    expect(entries.find((entry) => entry.name === "IVA general 21%")).toMatchObject({ inUse: true, companyName: "IVA", isDefault: true });
    expect(entries.find((entry) => entry.name === "Retención IRPF 15%")).toMatchObject({ inUse: true, companyName: "IRPF" });
    expect(custom.map((entry) => entry.name)).toEqual(["Ecotasa"]);
    expect(await inUseOf("antigua")).toEqual(["IVA general 21%", "Retención IRPF 15%"]);

    const reduced = entries.find((entry) => entry.name === "IVA reducido 10%")!;
    await setCompanyCatalogTaxInUse("antigua", reduced.code, true);
    expect(await activeNames("antigua")).toEqual(["Ecotasa", "IRPF", "IVA", "IVA reducido 10%"]);
    // Volver a marcar uno que ya se usa no lo duplica.
    await setCompanyCatalogTaxInUse("antigua", entries.find((entry) => entry.name === "IVA general 21%")!.code, true);
    expect((await state.db.select().from(tax).where(eq(tax.companyId, "antigua"))).length).toBe(4);
  });
});

describe("tratamientos de IVA de la empresa", () => {
  it("automáticos hasta que se eligen; se guardan con el nacional y se puede volver a los automáticos", async () => {
    await state.db.update(companySettings).set({ businessType: "services" }).where(eq(companySettings.companyId, "nueva"));
    expect(await getCompanySalesVatTreatments("nueva")).toEqual({ enabled: ["DOMESTIC", "INTRA_EU_SERVICES", "NOT_SUBJECT"], automatic: true });
    expect(await saveCompanySalesVatTreatments("nueva", ["REVERSE_CHARGE"])).toEqual({ enabled: ["DOMESTIC", "REVERSE_CHARGE"], automatic: false });
    expect((await saveCompanySalesVatTreatments("nueva", null)).automatic).toBe(true);
  });
});
