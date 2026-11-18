import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Panel de plataforma contra Postgres real (PGlite): acciones de soporte sobre espacios y usuarios. */

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
vi.mock("@/lib/current-user", () => ({ getUserSession: vi.fn() }));

import * as schema from "@/db/schema";
import { membership, session, tenant, user } from "@/db/schema";
import { getTenantBillingAccess } from "@/server/billing/access";
import { getOcrCreditBalance } from "@/server/billing/credits";
import { applyPlatformTenantAction, applyPlatformUserAction, listPlatformTenants, summarizePlatform } from "@/server/platform/service";

beforeAll(async () => {
  vi.stubEnv("BILLING_ENFORCED", "true");
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values([
    { id: "admin", name: "Admin", email: "admin@example.com", platformAdmin: true },
    { id: "cliente", name: "Cliente", email: "cliente@example.com" },
  ]);
  await state.db.insert(tenant).values({ id: "t", name: "Bar Pepe", slug: "bar-pepe", ownerId: "cliente", trialEndsAt: new Date(Date.now() - 86_400_000) });
  await state.db.insert(membership).values({ userId: "cliente", tenantId: "t", role: "OWNER" });
  await state.db.insert(session).values({ id: "s1", token: "hash", userId: "cliente", expiresAt: new Date(Date.now() + 86_400_000) });
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await state.client?.close();
});

describe("panel de plataforma", () => {
  it("lista los espacios con su estado y busca por email del propietario", async () => {
    const rows = await listPlatformTenants({ q: "cliente@" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Bar Pepe", ownerEmail: "cliente@example.com", state: "trial_expired", members: 1 });
    expect(summarizePlatform(rows)).toMatchObject({ tenants: 1, readOnly: 1 });
  });

  it("ampliar la prueba, dar cortesía, ajustar créditos y suspender cambian el acceso", async () => {
    await applyPlatformTenantAction("admin", "t", { action: "extendTrial", days: 7 });
    expect((await getTenantBillingAccess("t")).state).toBe("trial");
    await applyPlatformTenantAction("admin", "t", { action: "grantCredits", credits: 40, note: "Compensación" });
    expect(await getOcrCreditBalance("t")).toBe(40);
    await applyPlatformTenantAction("admin", "t", { action: "suspend", reason: "Envío de spam" });
    expect(await getTenantBillingAccess("t")).toMatchObject({ state: "suspended", blocked: true });
    await applyPlatformTenantAction("admin", "t", { action: "unsuspend" });
    await applyPlatformTenantAction("admin", "t", { action: "exempt", exempt: true });
    expect((await getTenantBillingAccess("t")).state).toBe("exempt");
  });

  it("bloquear un usuario cierra sus sesiones; no puedes bloquearte a ti mismo", async () => {
    await applyPlatformUserAction("admin", "cliente", { action: "disable" });
    expect((await state.db.select().from(user).where(eq(user.id, "cliente")))[0].disabledAt).toBeInstanceOf(Date);
    expect(await state.db.select().from(session).where(eq(session.userId, "cliente"))).toHaveLength(0);
    await expect(applyPlatformUserAction("admin", "admin", { action: "disable" })).rejects.toMatchObject({ status: 409 });
  });
});
