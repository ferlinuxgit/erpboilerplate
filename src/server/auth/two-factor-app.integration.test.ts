import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Verificación en dos pasos con app contra Postgres real (PGlite): alta, reutilización y recuperación. */

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
import { user } from "@/db/schema";
import { totpCodeAt, totpStep } from "@/server/auth/totp";
import { disableTotp, enableTotp, getTotpStatus, regenerateRecoveryCodes, startTotpSetup, userHasTotp, verifyUserSecondFactor } from "@/server/auth/two-factor-app";

beforeAll(async () => {
  process.env.JWT_SECRET = "x".repeat(40);
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: "ana", name: "Ana", email: "ana@example.com" });
}, 120_000);

afterAll(async () => {
  await state.client?.close();
});

describe("verificación con app", () => {
  it("alta, un código no vale dos veces, recuperación de un solo uso y baja", async () => {
    const setup = await startTotpSetup("ana");
    expect(setup.uri).toContain("otpauth://totp/");
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const [stored] = await state.db.select({ secret: user.totpSecretEncrypted }).from(user).where(eq(user.id, "ana"));
    expect(stored.secret).not.toContain(setup.secret);
    expect(await userHasTotp("ana")).toBe(false);

    await expect(enableTotp("ana", "000000")).rejects.toMatchObject({ status: 400 });
    const step = totpStep();
    const { recoveryCodes } = await enableTotp("ana", totpCodeAt(setup.secret, step));
    expect(recoveryCodes).toHaveLength(10);
    expect(await userHasTotp("ana")).toBe(true);

    // El código con el que se activó ya está gastado; el siguiente paso sí vale (una vez).
    expect(await verifyUserSecondFactor("ana", totpCodeAt(setup.secret, step))).toBeNull();
    const next = totpCodeAt(setup.secret, step + 1);
    const results = await Promise.all([verifyUserSecondFactor("ana", next), verifyUserSecondFactor("ana", next)]);
    expect(results.filter((result) => result === "totp")).toHaveLength(1);

    expect(await verifyUserSecondFactor("ana", recoveryCodes[0].toLowerCase())).toBe("recovery");
    expect(await verifyUserSecondFactor("ana", recoveryCodes[0])).toBeNull();
    expect((await getTotpStatus("ana")).recoveryCodesLeft).toBe(9);

    const renewed = await regenerateRecoveryCodes("ana", recoveryCodes[1]);
    expect(await verifyUserSecondFactor("ana", recoveryCodes[2])).toBeNull();
    await expect(disableTotp("ana", "ZZZZZ-ZZZZZ")).rejects.toMatchObject({ status: 400 });
    await disableTotp("ana", renewed.recoveryCodes[0]);
    expect(await getTotpStatus("ana")).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
  });
});
