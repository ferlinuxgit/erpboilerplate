import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Plazo de pago y cuentas por defecto contra Postgres real (PGlite). */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
  hasEntries: false,
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});

vi.mock("@/server/accounting/subaccounts", () => ({
  companyHasJournalEntries: async () => state.hasEntries,
}));

import * as schema from "@/db/schema";
import { accountChart, auditLog, company, companySettings, tenant, user } from "@/db/schema";
import { updateDefaultAccounts, updateDefaultPaymentTerms } from "@/server/company/billing-defaults";

const actor = { tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1" };
const accounts = { customer: "4300", supplier: "4100", sales: "705", purchase: "629", bank: "572" };

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: "company-1", tenantId: "tenant-1", name: "Empresa" });
  for (const code of ["4300", "4100", "700", "705", "600", "629", "572"]) {
    await state.db.insert(accountChart).values({ companyId: "company-1", code, name: `Cuenta ${code}`, type: "ASSET", isPostable: false });
  }
}, 60_000);

afterAll(async () => {
  await state.client?.close();
});

async function settings() {
  const [row] = await state.db.select().from(companySettings).where(eq(companySettings.companyId, "company-1"));
  return row;
}

describe("plazo de pago por defecto", () => {
  it("lo guarda (creando los ajustes si no existían) y deja rastro en auditoría", async () => {
    await updateDefaultPaymentTerms(actor, 45);
    expect((await settings()).paymentTermsDays).toBe(45);
    const audits = await state.db.select().from(auditLog).where(eq(auditLog.action, "companySettings.paymentTerms"));
    expect(audits).toHaveLength(1);
  });

  it("rechaza plazos fuera de 0–365 días o con decimales", async () => {
    for (const days of [-1, 366, 7.5, Number.NaN]) {
      await expect(updateDefaultPaymentTerms(actor, days)).rejects.toMatchObject({ status: 400 });
    }
    expect((await settings()).paymentTermsDays).toBe(45);
  });
});

describe("cuentas por defecto", () => {
  it("guarda cuentas que existen en el plan contable", async () => {
    await updateDefaultAccounts(actor, accounts);
    expect(await settings()).toMatchObject({
      defaultCustomerAccountCode: "4300",
      defaultSalesAccountCode: "705",
      defaultPurchaseAccountCode: "629",
      // El plazo guardado antes no se toca.
      paymentTermsDays: 45,
    });
  });

  it("rechaza códigos no numéricos y cuentas que no existen, diciendo cuáles", async () => {
    await expect(updateDefaultAccounts(actor, { ...accounts, sales: "ventas" })).rejects.toMatchObject({ status: 400 });
    await expect(updateDefaultAccounts(actor, { ...accounts, purchase: "6290" })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("6290") });
    expect((await settings()).defaultPurchaseAccountCode).toBe("629");
  });

  it("no deja cambiarlas cuando ya hay asientos", async () => {
    state.hasEntries = true;
    await expect(updateDefaultAccounts(actor, { ...accounts, sales: "700" })).rejects.toMatchObject({ status: 409 });
    expect((await settings()).defaultSalesAccountCode).toBe("705");
    state.hasEntries = false;
  });
});
