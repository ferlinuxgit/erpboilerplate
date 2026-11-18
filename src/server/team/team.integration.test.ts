import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Equipo contra Postgres real (PGlite): bajas, roles y API keys de quien deja el equipo. */

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
import { apiKey, membership, tenant, user } from "@/db/schema";
import { removeTeamMember, updateTeamMemberRole } from "@/server/team/service";

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values([
    { id: "ana", name: "Ana", email: "ana@example.com" },
    { id: "bea", name: "Bea", email: "bea@example.com" },
    { id: "carlos", name: "Carlos", email: "carlos@example.com" },
  ]);
  await state.db.insert(tenant).values({ id: "t", name: "T", slug: "t", ownerId: "ana" });
  await state.db.insert(membership).values([
    { id: "m-ana", userId: "ana", tenantId: "t", role: "OWNER" },
    { id: "m-bea", userId: "bea", tenantId: "t", role: "OWNER" },
    { id: "m-carlos", userId: "carlos", tenantId: "t", role: "ADMIN" },
  ]);
}, 120_000);

afterAll(async () => {
  await state.client?.close();
});

describe("equipo", () => {
  it("al quitar a alguien del equipo se revocan las API keys que creó (las de otros no)", async () => {
    await state.db.insert(apiKey).values([
      { id: "k-carlos", tenantId: "t", keyHash: "x", keyPrefix: "ak_carlos", name: "Integración de Carlos", createdByUserId: "carlos" },
      { id: "k-ana", tenantId: "t", keyHash: "x", keyPrefix: "ak_ana", name: "Integración de Ana", createdByUserId: "ana" },
    ]);
    expect(await removeTeamMember({ tenantId: "t", membershipId: "m-carlos", actorUserId: "ana", actorRole: "OWNER" })).toBe(true);
    const active = await state.db.select({ id: apiKey.id }).from(apiKey).where(and(eq(apiKey.tenantId, "t"), isNull(apiKey.revokedAt)));
    expect(active.map((row: { id: string }) => row.id)).toEqual(["k-ana"]);
  });

  it("dos propietarios que se quitan el rol a la vez no dejan el espacio sin propietario", async () => {
    const results = await Promise.allSettled([
      updateTeamMemberRole({ tenantId: "t", membershipId: "m-ana", actorUserId: "bea", actorRole: "OWNER", role: "ADMIN" }),
      updateTeamMemberRole({ tenantId: "t", membershipId: "m-bea", actorUserId: "ana", actorRole: "OWNER", role: "ADMIN" }),
    ]);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const owners = await state.db.select({ id: membership.id }).from(membership).where(and(eq(membership.tenantId, "t"), eq(membership.role, "OWNER")));
    expect(owners).toHaveLength(1);
    await expect(removeTeamMember({ tenantId: "t", membershipId: owners[0].id, actorUserId: "ana", actorRole: "OWNER" })).rejects.toMatchObject({ status: 409 });
  });
});
