import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Árbol del plan contable contra Postgres real (PGlite en memoria, esquema completo de Drizzle):
 * sumas por prefijo en SQL, saldo inicial y periodo, carga perezosa, filtros, búsqueda con
 * ancestros y atajo del punto, ficha con series mensuales y rendimiento con 10.000 subcuentas.
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
import { accountChart, company, companySettings, fiscalYear, tenant, user } from "@/db/schema";
import { NO_CHART_FILTERS } from "@/lib/chart-of-accounts/query";
import type { ChartFilters } from "@/lib/chart-of-accounts/types";
import { getAccountSummary, getChartTree, listChartForExport, resolveChartPeriod, suggestNextSubaccount } from "@/server/accounting/chart-tree";
import { createJournalEntry, listAccounts, setAccountBlocked } from "@/server/accounting/service";
import { ensureSubaccount } from "@/server/accounting/subaccounts";
import { createCustomerWithPartner } from "@/server/customers/service";
import { applyEsSeeds } from "@/server/seeds/apply";

const TENANT = "tenant-tree";
const USER = "user-tree";
const COMPANY = "company-tree";
const YEAR_2026 = { from: new Date(Date.UTC(2026, 0, 1)), toExclusive: new Date(Date.UTC(2027, 0, 1)) };

let customerAccountId = "";
let customerId = "";

function filters(partial: Partial<ChartFilters>): ChartFilters {
  return { ...NO_CHART_FILTERS, ...partial };
}

async function accountId(code: string) {
  const [row] = await state.db.select({ id: accountChart.id }).from(accountChart).where(and(eq(accountChart.companyId, COMPANY), eq(accountChart.code, code))).limit(1);
  return row.id as string;
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: USER, name: "Ana", email: "ana-tree@example.com" });
  await state.db.insert(tenant).values({ id: TENANT, name: "T", slug: "t-tree", ownerId: USER });
  await state.db.insert(company).values({ id: COMPANY, tenantId: TENANT, name: "Empresa árbol", countryCode: "ES" });
  await state.db.insert(companySettings).values({ companyId: COMPANY, subaccountLength: 8, businessType: "both" });
  await state.db.insert(fiscalYear).values([
    { id: "fy2025", companyId: COMPANY, code: "2025", startsAt: new Date(Date.UTC(2025, 0, 1)), endsAt: new Date(Date.UTC(2025, 11, 31)) },
    { id: "fy2026", companyId: COMPANY, code: "2026", startsAt: new Date(Date.UTC(2026, 0, 1)), endsAt: new Date(Date.UTC(2026, 11, 31)) },
  ]);
  await applyEsSeeds({ tenantId: TENANT, companyId: COMPANY, actorUserId: USER, activeFiscalYearId: "fy2026" });
  const created = await createCustomerWithPartner(state.db, COMPANY, {
    name: "Pérez S.L.",
    taxId: "B12345674",
    address: "Calle Mayor 1",
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    countryCode: "ES",
  });
  customerId = created.id;
  customerAccountId = await accountId("43000001");
  const bank = await ensureSubaccount(COMPANY, "572");
  const sales = await ensureSubaccount(COMPANY, "700");
  const vat = await ensureSubaccount(COMPANY, "477");
  const post = (date: Date, lines: Array<{ accountId: string; debit?: string; credit?: string }>) =>
    createJournalEntry(COMPANY, TENANT, USER, { postedAt: date, reference: "Prueba", lines: lines.map((line) => ({ accountId: line.accountId, debit: line.debit ?? "", credit: line.credit ?? "" })) });
  await post(new Date(Date.UTC(2025, 5, 1)), [{ accountId: customerAccountId, debit: "121" }, { accountId: sales.id, credit: "100" }, { accountId: vat.id, credit: "21" }]);
  await post(new Date(Date.UTC(2026, 1, 10)), [{ accountId: bank.id, debit: "50" }, { accountId: customerAccountId, credit: "50" }]);
  await post(new Date(Date.UTC(2026, 2, 5)), [{ accountId: customerAccountId, debit: "242" }, { accountId: sales.id, credit: "200" }, { accountId: vat.id, credit: "42" }]);
}, 180_000);

afterAll(async () => {
  await state.client?.close();
});

describe("getChartTree", () => {
  it("carga los niveles 1 y 2 con sumas por prefijo, saldo inicial y debe/haber del ejercicio", async () => {
    const tree = await getChartTree(COMPANY, { ...YEAR_2026, depth: 2 });
    const codes = tree.nodes.map((node) => node.code);
    expect(codes).toContain("4");
    expect(codes).toContain("43");
    expect(codes.every((code) => code.length <= 2)).toBe(true);
    expect(tree.nodes.filter((node) => node.level === 1)).toHaveLength(9);
    const clients = tree.nodes.find((node) => node.code === "43");
    expect(clients).toMatchObject({ openingCents: 12100, debitCents: 24200, creditCents: 5000, balanceCents: 31300, entries: 2, parentCode: "4", nature: "DEBIT" });
    expect(clients?.childCount).toBeGreaterThan(0);
    const income = tree.nodes.find((node) => node.code === "7");
    expect(income).toMatchObject({ openingCents: -10000, creditCents: 20000, balanceCents: -30000 });
    expect(tree.loadedParents).toEqual(expect.arrayContaining(["", "4", "7"]));
    expect(tree.loadedParents).not.toContain("43");
    expect(tree.range).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("limita el periodo: saldo inicial con todo lo anterior y debe/haber solo del periodo", async () => {
    const march = { from: new Date(Date.UTC(2026, 2, 1)), toExclusive: new Date(Date.UTC(2026, 3, 1)) };
    const tree = await getChartTree(COMPANY, { ...march, depth: 2 });
    expect(tree.nodes.find((node) => node.code === "43")).toMatchObject({ openingCents: 7100, debitCents: 24200, creditCents: 0, balanceCents: 31300, entries: 1 });
    expect(tree.nodes.find((node) => node.code === "57")).toMatchObject({ openingCents: 5000, debitCents: 0, entries: 0, hasMovements: true });
  });

  it("despliega solo los hijos directos de una cuenta, con el tercero de cada subcuenta", async () => {
    const tree = await getChartTree(COMPANY, { ...YEAR_2026, parentCode: "4300" });
    expect(tree.loadedParents).toEqual(["4300"]);
    const customer = tree.nodes.find((node) => node.code === "43000001");
    expect(customer).toMatchObject({ partnerName: "Pérez S.L.", partnerTaxId: "B12345674", isPostable: true, balanceCents: 31300, childCount: 0 });
    expect(tree.nodes.every((node) => node.parentCode === "4300")).toBe(true);
  });

  it("filtra por movimientos, terceros y bloqueadas conservando los grupos que las contienen", async () => {
    const withMovements = await getChartTree(COMPANY, { ...YEAR_2026, depth: 1, filters: filters({ movements: true }) });
    expect(withMovements.nodes.map((node) => node.code)).toEqual(["4", "5", "7"]);

    const partners = await getChartTree(COMPANY, { ...YEAR_2026, depth: 2, filters: filters({ partners: true }) });
    expect(partners.nodes.map((node) => node.code)).toEqual(["4", "40", "41", "43"]);

    const nonzero = await getChartTree(COMPANY, { ...YEAR_2026, parentCode: "4300", filters: filters({ nonzero: true }) });
    expect(nonzero.nodes.map((node) => node.code)).toEqual(["43000001"]);

    await setAccountBlocked(COMPANY, TENANT, USER, await accountId("57200000"), true);
    const blocked = await getChartTree(COMPANY, { ...YEAR_2026, depth: 2, filters: filters({ blocked: true }) });
    expect(blocked.nodes.map((node) => node.code)).toEqual(["5", "57"]);
    const blockedLeaf = await getChartTree(COMPANY, { ...YEAR_2026, parentCode: "572", filters: filters({ blocked: true }) });
    expect(blockedLeaf.nodes.map((node) => [node.code, node.isBlocked])).toEqual([["57200000", true]]);
    await expect(setAccountBlocked(COMPANY, TENANT, USER, await accountId("572"), true)).rejects.toThrow("Solo se pueden bloquear subcuentas");
    await setAccountBlocked(COMPANY, TENANT, USER, await accountId("57200000"), false);
  });

  it("busca con el atajo del punto, por tercero y por NIF, devolviendo la rama de grupos", async () => {
    for (const q of ["43.1", "pérez", "B1234"]) {
      const result = await getChartTree(COMPANY, { ...YEAR_2026, q });
      expect(result.matchCodes, q).toEqual(["43000001"]);
      expect(result.nodes.map((node) => node.code), q).toEqual(["4", "43", "430", "4300", "43000001"]);
      expect(result.nodes.map((node) => node.parentCode), q).toEqual([null, "4", "43", "430", "4300"]);
      expect(result.loadedParents, q).toEqual(["", "4", "43", "430", "4300"]);
    }
    const byCode = await getChartTree(COMPANY, { ...YEAR_2026, q: "4300" });
    expect(byCode.matchCodes).toEqual(["4300", "43000000", "43000001"].filter((code) => byCode.matchCodes.includes(code)));
    expect(byCode.matchCodes[0]).toBe("4300");
    const none = await getChartTree(COMPANY, { ...YEAR_2026, q: "zzzz-no-existe" });
    expect(none.nodes).toEqual([]);
  });

  it("revela la rama de una subcuenta además del nivel pedido", async () => {
    const tree = await getChartTree(COMPANY, { ...YEAR_2026, depth: 2, reveal: "43000001" });
    const codes = tree.nodes.map((node) => node.code);
    expect(codes).toEqual(expect.arrayContaining(["4", "43", "430", "4300", "43000001"]));
    expect(tree.loadedParents).toEqual(expect.arrayContaining(["43", "430", "4300"]));
  });

  it("exporta hasta el nivel pedido en orden jerárquico", async () => {
    const level3 = await listChartForExport(COMPANY, { ...YEAR_2026, level: "3" });
    expect(level3.nodes.every((node) => node.code.length <= 3)).toBe(true);
    const codes = level3.nodes.map((node) => node.code);
    expect(codes.indexOf("43")).toBeLessThan(codes.indexOf("430"));
    expect(codes.indexOf("430")).toBeLessThan(codes.indexOf("44"));
  });
});

describe("ficha de la cuenta", () => {
  it("devuelve ruta, tercero, sumas y la evolución mensual del ejercicio frente al anterior", async () => {
    const period = await resolveChartPeriod(COMPANY, { fy: "fy2026" });
    const summary = await getAccountSummary(COMPANY, customerAccountId, period);
    expect(summary?.path.map((step) => step.code)).toEqual(["4", "43", "430", "4300", "43000001"]);
    expect(summary?.partner).toMatchObject({ name: "Pérez S.L.", taxId: "B12345674", href: `/customers/${customerId}` });
    expect(summary?.totals).toMatchObject({ openingCents: 12100, debitCents: 24200, creditCents: 5000, balanceCents: 31300 });
    expect(summary?.months).toHaveLength(12);
    expect(summary?.months[0]).toMatchObject({ key: "2026-01", label: "ene", longLabel: "enero 2026" });
    expect(summary?.current.balanceCents.slice(0, 3)).toEqual([12100, 7100, 31300]);
    expect(summary?.current.creditCents[1]).toBe(5000);
    expect(summary?.previous?.label).toBe("Ejercicio 2025");
    expect(summary?.previous?.balanceCents[4]).toBe(0);
    expect(summary?.previous?.balanceCents[5]).toBe(12100);
    expect(summary?.lastLines.map((line) => line.debitCents || -line.creditCents)).toEqual([24200, -5000, 12100]);
    expect(summary?.nextSubaccountCode).toBe("43000002");
  });

  it("en una cuenta de grupo suma toda su rama y propone la siguiente subcuenta", async () => {
    const period = await resolveChartPeriod(COMPANY, { fy: "fy2026" });
    const summary = await getAccountSummary(COMPANY, await accountId("43"), period);
    expect(summary?.totals.balanceCents).toBe(31300);
    expect(summary?.childCount).toBeGreaterThan(0);
    expect(summary?.nextSubaccountCode).toBeNull();
    expect(await suggestNextSubaccount(COMPANY, "572")).toEqual({ parentCode: "572", code: "57200001" });
    expect(await suggestNextSubaccount(COMPANY, "4")).toBeNull();
  });

  it("listAccounts por periodo lleva saldo inicial y sumas del periodo", async () => {
    const rows = await listAccounts(COMPANY, YEAR_2026);
    expect(rows.find((row) => row.code === "43000001")).toMatchObject({ opening: 121, debit: 242, credit: 50, balance: 313 });
    expect(rows.find((row) => row.code === "4")?.opening).toBe(121 - 21);
  });
});

describe("rendimiento", () => {
  it("con 10.000 subcuentas de terceros el primer nivel y el despliegue de 4300 son rápidos", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      companyId: COMPANY,
      code: `4300${String(index + 100).padStart(4, "0")}`,
      name: `Cliente ${index}`,
      type: "ASSET" as const,
      parentCode: "4300",
      level: 8,
      isPostable: true,
      isActive: true,
      nature: "DEBIT",
    }));
    for (let start = 0; start < rows.length; start += 2_000) await state.db.insert(accountChart).values(rows.slice(start, start + 2_000));

    let started = performance.now();
    const initial = await getChartTree(COMPANY, { ...YEAR_2026, depth: 2 });
    expect(initial.nodes.length).toBeLessThan(120);
    expect(performance.now() - started).toBeLessThan(5_000);

    started = performance.now();
    const expanded = await getChartTree(COMPANY, { ...YEAR_2026, parentCode: "4300" });
    expect(expanded.nodes.length).toBeGreaterThan(10_000);
    expect(expanded.nodes.find((node) => node.code === "43000001")?.balanceCents).toBe(31300);
    expect(performance.now() - started).toBeLessThan(8_000);

    const search = await getChartTree(COMPANY, { ...YEAR_2026, q: "Cliente 99" });
    expect(search.matchCodes.length).toBeGreaterThan(0);
    expect(search.matchCodes.length).toBeLessThanOrEqual(200);
    const truncated = await getChartTree(COMPANY, { ...YEAR_2026, q: "4300" });
    expect(truncated.truncated).toBe(true);
    expect(truncated.matchCodes).toHaveLength(200);
  }, 60_000);
});
