import { beforeEach, describe, expect, it, vi } from "vitest";

const { argon2Mock, userRows, insertMock } = vi.hoisted(() => ({
  argon2Mock: {
    hash: vi.fn(async () => "$argon2id$dummy-hash"),
    verify: vi.fn(async () => false),
  },
  userRows: { current: [] as Array<Record<string, unknown>> },
  insertMock: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
}));

vi.mock("argon2", () => ({ ...argon2Mock, default: argon2Mock }));
vi.mock("@/server/email/send", () => ({ isEmailDeliveryConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      // 1ª consulta: usuario (lleva `password`); 2ª: política 2FA (vacía).
      const rows = "password" in selection ? userRows.current : [];
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => rows),
      };
      return chain;
    }),
    insert: insertMock,
  },
}));

function loginRequest(email: string, password = "wrong-password") {
  return new Request("https://erp.example.com/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify({ email, password }),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.resetModules();
    argon2Mock.verify.mockReset();
    argon2Mock.verify.mockResolvedValue(false);
    argon2Mock.hash.mockClear();
    userRows.current = [];
  });

  it("runs argon2 against a dummy hash when the user does not exist and returns a generic error", async () => {
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(loginRequest("ghost@example.com"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Email o contraseña incorrectos." });
    expect(argon2Mock.verify).toHaveBeenCalledTimes(1);
    expect(argon2Mock.verify).toHaveBeenCalledWith("$argon2id$dummy-hash", "wrong-password");
  });

  it("returns the same response for an existing user with a wrong password", async () => {
    userRows.current = [{ id: "user-1", name: "Ana", email: "ana@example.com", emailVerified: true, password: "$argon2id$real" }];
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(loginRequest("ana@example.com"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Email o contraseña incorrectos." });
    expect(argon2Mock.verify).toHaveBeenCalledWith("$argon2id$real", "wrong-password");
  });

  it("limits failed attempts per email and answers 429 with Retry-After", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const email = `limited-${Date.now()}@example.com`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(loginRequest(email))).status).toBe(401);
    }
    const blocked = await POST(loginRequest(email));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(argon2Mock.verify).toHaveBeenCalledTimes(5);
  });

  it("creates a session with the proxy-derived client IP on success", async () => {
    userRows.current = [{ id: "user-1", name: "Ana", email: "ana@example.com", emailVerified: true, password: "$argon2id$real" }];
    argon2Mock.verify.mockResolvedValue(true);
    const values = vi.fn(async () => undefined);
    insertMock.mockReturnValueOnce({ values });
    const { POST } = await import("@/app/api/auth/login/route");

    const response = await POST(loginRequest("ana@example.com", "correct-password"));

    expect(response.status).toBe(200);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", ipAddress: "203.0.113.10" }));
  });
});
