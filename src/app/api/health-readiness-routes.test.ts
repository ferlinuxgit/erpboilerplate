import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pool = {
    query: vi.fn(),
    end: vi.fn(),
  };

  return {
    pool,
    Pool: vi.fn(function MockPool() {
      return pool;
    }),
  };
});

vi.mock("pg", () => ({ Pool: mocks.Pool }));

const ORIGINAL_ENV = process.env;

describe("health and readiness route handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.pool.query.mockReset();
    mocks.pool.end.mockReset();
    mocks.pool.end.mockResolvedValue(undefined);
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DATABASE_URL;
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
    expect(mocks.Pool).not.toHaveBeenCalled();
  });

  it("reports ready when the database dependency answers a safe probe", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@db.example.com:5432/app";
    process.env.GIT_SHA = "abcdef1234567890";
    mocks.pool.query.mockResolvedValue({ rows: [{ ready: 1 }] });
    const { GET } = await import("@/app/api/readyz/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "ok",
      checks: {
        database: "ok",
      },
      version: {
        sha: "abcdef1",
      },
    });
    expect(mocks.Pool).toHaveBeenCalledWith({
      connectionString: "postgresql://user:secret@db.example.com:5432/app",
      connectionTimeoutMillis: 1000,
      idleTimeoutMillis: 1000,
      max: 1,
      query_timeout: 1000,
      statement_timeout: 1000,
    });
    expect(mocks.pool.query).toHaveBeenCalledWith("select 1 as ready");
    expect(mocks.pool.end).toHaveBeenCalled();
  });

  it("returns sanitized degraded readiness when DATABASE_URL is missing", async () => {
    const { GET } = await import("@/app/api/readyz/route");

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      service: "erpboilerplate",
      status: "degraded",
      checks: {
        database: "missing_configuration",
      },
      version: {
        sha: "unknown",
      },
    });
    expect(mocks.Pool).not.toHaveBeenCalled();
  });

  it("returns sanitized degraded readiness when the database probe fails", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@db.example.com:5432/app";
    mocks.pool.query.mockRejectedValue(new Error("password secret failed for postgresql://user:secret@db.example.com/app"));
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
      },
      version: {
        sha: "unknown",
      },
    });
    expect(mocks.pool.end).toHaveBeenCalled();
  });
});
