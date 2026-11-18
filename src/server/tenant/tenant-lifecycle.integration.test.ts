import { eq } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Portabilidad y bajas contra Postgres real (PGlite): la exportación lleva todos los datos del espacio
 * (también las tablas hijas, como las líneas de factura) y NADA de otros espacios; la baja deja el
 * espacio en solo lectura y la purga respeta la gracia; borrar un usuario lo anonimiza.
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
import { company, customer, invoice, invoiceLine, membership, tenant, user } from "@/db/schema";
import { getTenantBillingAccess } from "@/server/billing/access";
import { buildTenantExportPlan, streamTenantExport } from "@/server/tenant/export";
import { deleteUserAccount, purgeTenant, requestTenantDeletion } from "@/server/tenant/lifecycle";

async function seedTenant(id: string, ownerId: string) {
  await state.db.insert(tenant).values({ id, name: `Espacio ${id}`, slug: id, ownerId });
  await state.db.insert(membership).values({ userId: ownerId, tenantId: id, role: "OWNER" });
  await state.db.insert(company).values({ id: `${id}-co`, tenantId: id, name: `Empresa ${id}` });
  await state.db.insert(customer).values({ id: `${id}-cu`, companyId: `${id}-co`, name: `Cliente de ${id}` });
  await state.db.insert(invoice).values({ id: `${id}-inv`, companyId: `${id}-co`, customerId: `${id}-cu`, number: `F-${id}`, issueDate: new Date(), totalAmount: "121.00" });
  await state.db.insert(invoiceLine).values({ invoiceId: `${id}-inv`, description: `Servicio de ${id}`, quantity: "1", unitPrice: "100", lineTotal: "121" });
}

async function readZip(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk, offset);
    offset += chunk.length;
  }
  return unzipSync(total);
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values([
    { id: "ana", name: "Ana", email: "ana@example.com" },
    { id: "otro", name: "Otro", email: "otro@example.com" },
  ]);
  await seedTenant("a", "ana");
  await seedTenant("b", "otro");
}, 120_000);

afterAll(async () => {
  await state.client?.close();
});

describe("exportación completa", () => {
  it("el plan cubre las tablas de empresa, de espacio e hijas, y nunca credenciales", () => {
    const tables = new Map(buildTenantExportPlan().map((entry) => [entry.table, entry.scope.kind]));
    expect(tables.get("invoice")).toBe("company");
    expect(tables.get("membership")).toBe("tenant");
    expect(tables.get("invoice_line")).toBe("child");
    for (const secret of ["session", "account", "api_key", "verification"]) expect(tables.has(secret)).toBe(false);
  });

  it("el ZIP lleva los datos del espacio y nada de otros espacios", async () => {
    const files = await readZip(streamTenantExport("a"));
    const lines = strFromU8(files["datos/invoice_line.jsonl"]);
    expect(lines).toContain("Servicio de a");
    const everything = Object.entries(files).filter(([name]) => name.startsWith("datos/")).map(([, content]) => strFromU8(content)).join("\n");
    expect(everything).not.toContain("Servicio de b");
    expect(everything).not.toContain("Cliente de b");
    expect(JSON.parse(strFromU8(files["manifiesto.json"]))).toMatchObject({ tenantId: "a" });
  });
});

describe("bajas", () => {
  it("al pedir la baja el espacio queda en solo lectura y la purga espera a que pase la gracia", async () => {
    await requestTenantDeletion({ tenantId: "b", actorUserId: "otro" });
    expect(await getTenantBillingAccess("b")).toMatchObject({ state: "closing", readOnly: true });
    await expect(purgeTenant({ tenantId: "b", actorUserId: "admin" })).rejects.toMatchObject({ status: 409 });
    await purgeTenant({ tenantId: "b", actorUserId: "admin", now: new Date(Date.now() + 31 * 86_400_000) });
    expect(await state.db.select().from(invoice).where(eq(invoice.companyId, "b-co"))).toHaveLength(0);
    expect(await state.db.select().from(tenant).where(eq(tenant.id, "b"))).toHaveLength(0);
  });

  it("no se puede borrar el usuario siendo el único propietario de un espacio activo; si no, se anonimiza", async () => {
    await expect(deleteUserAccount("ana")).rejects.toMatchObject({ status: 409 });
    // «otro» ya no es propietario de nada activo (su espacio se purgó).
    await deleteUserAccount("otro");
    const [row] = await state.db.select().from(user).where(eq(user.id, "otro"));
    expect(row).toMatchObject({ name: "Usuario eliminado", platformAdmin: false });
    expect(row.email).toMatch(/@cuentas\.invalid$/);
    expect(row.disabledAt).toBeInstanceOf(Date);
  });
});
