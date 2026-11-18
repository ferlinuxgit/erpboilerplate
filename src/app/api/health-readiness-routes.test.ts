import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La sonda usa la conexión compartida (@/lib/db), nunca una nueva por petición.
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));

const ORIGINAL_ENV = process.env;

describe("health and readiness route handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.execute.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    delete process.env.APP_URL;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.GIT_SHA;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns deterministic process liveness JSON without requiring DATABASE_URL", async () => {
    const { GET } = await import("@/app/api/health/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "ok",
      checks: {
        process: "ok",
      },
      version: {
        sha: "unknown",
      },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("reports ready when the database dependency answers a safe probe", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@db.example.com:5432/app";
    process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";
    process.env.APP_URL = "https://erp.example.com";
    process.env.GIT_SHA = "abcdef1234567890";
    mocks.execute.mockResolvedValue({ rows: [{ ready: 1 }] });
    const { GET } = await import("@/app/api/readyz/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "ok",
      checks: {
        database: "ok",
        auth: "ok",
      },
      version: {
        sha: "abcdef1",
      },
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    // Una segunda llamada seguida reutiliza el resultado: no vuelve a la base de datos.
    expect((await GET()).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("returns sanitized degraded readiness when DATABASE_URL is missing", async () => {
    process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";
    process.env.APP_URL = "https://erp.example.com";
    const { GET } = await import("@/app/api/readyz/route");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "degraded",
      checks: {
        database: "missing_configuration",
        auth: "ok",
      },
      version: {
        sha: "unknown",
      },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns sanitized degraded readiness when the database probe fails", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@db.example.com:5432/app";
    process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";
    process.env.APP_URL = "https://erp.example.com";
    mocks.execute.mockRejectedValue(new Error("password secret failed for postgresql://user:secret@db.example.com/app"));
    const { GET } = await import("@/app/api/readyz/route");

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.clone().text();
    expect(body).not.toContain("secret");
    expect(body).not.toContain("postgresql://");
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "degraded",
      checks: {
        database: "unavailable",
        auth: "ok",
      },
      version: {
        sha: "unknown",
      },
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("returns degraded readiness when auth runtime configuration is incomplete", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@db.example.com:5432/app";
    mocks.execute.mockResolvedValue({ rows: [{ ready: 1 }] });
    const { GET } = await import("@/app/api/readyz/route");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "degraded",
      checks: {
        database: "ok",
        auth: "missing_configuration",
      },
      version: {
        sha: "unknown",
      },
    });
  });

  it("returns degraded readiness when the auth secret is too short", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@db.example.com:5432/app";
    process.env.JWT_SECRET = "too-short";
    process.env.APP_URL = "https://erp.example.com";
    mocks.execute.mockResolvedValue({ rows: [{ ready: 1 }] });
    const { GET } = await import("@/app/api/readyz/route");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "degraded",
      checks: {
        database: "ok",
        auth: "insecure_configuration",
      },
      version: {
        sha: "unknown",
      },
    });
  });
});
