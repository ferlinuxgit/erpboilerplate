import { rmSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Cola de lectura de documentos contra Postgres real (PGlite): nunca más de 3 lecturas a la vez. */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
  active: 0,
  maxActive: 0,
  releases: [] as Array<() => void>,
}));

const uploadDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "ocr-queue-"));
  process.env.LOCAL_UPLOAD_DIR = dir;
  return dir;
});

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});

vi.mock("@/server/storage/s3", () => ({ isObjectStorageConfigured: () => false, putPrivateObject: vi.fn(), readPrivateObject: vi.fn(), deletePrivateObject: vi.fn() }));
vi.mock("@/server/ocr/settings", () => ({ getExpenseOcrSettings: async () => ({ externalAiEnabled: true, externalAiConfigured: true }) }));
// Lectura simulada que no termina hasta que el test la suelta: así se ve cuántas van a la vez.
vi.mock("@/server/ai/expense-invoice-analysis", () => ({
  analyzeExpenseInvoiceWithOpenAI: () => new Promise((resolve) => {
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    state.releases.push(() => {
      state.active -= 1;
      resolve({ draft: { lines: [], confidence: "high", warnings: [] }, analysis: {}, model: "test" });
    });
  }),
}));

import * as schema from "@/db/schema";
import { company, expenseOcrJob, tenant, user } from "@/db/schema";
import { createExpenseOcrJob, drainExpenseOcrQueue } from "@/server/ocr/expense-ocr";

const statuses = async () => (await state.db.select({ status: expenseOcrJob.status }).from(expenseOcrJob)).map((row: { status: string }) => row.status).sort();
const until = async (check: () => Promise<boolean> | boolean) => {
  for (let attempt = 0; attempt < 200 && !(await check()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: "company-1", tenantId: "tenant-1", name: "Empresa" });
}, 60_000);

afterAll(async () => {
  await state.client?.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("cola de lectura", () => {
  it("lee como mucho 3 a la vez, el resto espera en cola y se vacía entera", async () => {
    for (let index = 0; index < 7; index += 1) {
      await createExpenseOcrJob({ tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", fileName: `f${index}.pdf`, contentType: "application/pdf", buffer: Buffer.from(`%PDF-${index}`), extractionProvider: "openai" });
    }
    // Varias subidas seguidas piden vaciar la cola a la vez: no deben pasar de 3 lecturas.
    await Promise.all([drainExpenseOcrQueue(), drainExpenseOcrQueue(), drainExpenseOcrQueue()]);
    await until(() => state.active === 3);
    expect(await statuses()).toEqual(["PENDING", "PENDING", "PENDING", "PENDING", "PROCESSING", "PROCESSING", "PROCESSING"]);

    // Cada lectura que termina deja entrar la siguiente.
    while ((await statuses()).some((status) => status !== "DONE")) {
      await until(() => state.releases.length > 0);
      state.releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(state.maxActive).toBe(3);
    const done = await state.db.select().from(expenseOcrJob).where(eq(expenseOcrJob.status, "DONE"));
    expect(done).toHaveLength(7);
    expect(done.every((job: { attempts: number }) => job.attempts === 1)).toBe(true);
  });
});
