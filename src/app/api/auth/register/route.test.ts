import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
    insert: vi.fn(),
  },
  tx: {
    delete: vi.fn(),
    insert: vi.fn(),
  },
  deleteWhere: vi.fn(),
  insertValues: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  isEmailDeliveryConfigured: vi.fn(),
  sendEmail: vi.fn(),
  loggerError: vi.fn(),
  hashAuthToken: vi.fn((value: string) => `hashed:${value}`),
  selectResult: [] as Array<Record<string, unknown>>,
}));

vi.mock("argon2", () => ({
  verify: mocks.verifyPassword,
  hash: mocks.hashPassword,
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.loggerError } }));
vi.mock("@/lib/auth", () => ({
  AUTH_TOKEN_COOKIE: "auth-token",
  createAuthToken: vi.fn(),
  getAuthCookieOptions: vi.fn(),
  hashAuthToken: mocks.hashAuthToken,
}));
vi.mock("@/server/email/send", () => ({
  escapeEmailHtml: (value: string) => value,
  isEmailDeliveryConfigured: mocks.isEmailDeliveryConfigured,
  sendEmail: mocks.sendEmail,
}));

import { POST } from "./route";

function registrationRequest() {
  return new Request("https://erp.example.com/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Existing User",
      email: "existing@example.com",
      password: "correct-password",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", "https://erp.example.com");
  delete process.env.REQUIRE_EMAIL_VERIFICATION;

  mocks.selectResult = [{
    id: "user-1",
    name: "Existing User",
    email: "existing@example.com",
    emailVerified: false,
    password: "stored-password-hash",
  }];
  mocks.db.select.mockImplementation(() => {
    const chain = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => mocks.selectResult),
    };
    chain.from.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return chain;
  });
  mocks.tx.delete.mockReturnValue({ where: mocks.deleteWhere });
  mocks.tx.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.deleteWhere.mockResolvedValue(undefined);
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.db.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.isEmailDeliveryConfigured.mockReturnValue(true);
  mocks.sendEmail.mockResolvedValue({ messageId: "message-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/register recovery", () => {
  it("replaces the token and resends verification for matching unverified credentials", async () => {
    const response = await POST(registrationRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      user: { id: "user-1", name: "Existing User", email: "existing@example.com" },
      requiresEmailVerification: true,
      verificationEmailResent: true,
    });
    expect(mocks.verifyPassword).toHaveBeenCalledWith("stored-password-hash", "correct-password");
    expect(mocks.tx.delete).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      identifier: "email:user-1",
      value: expect.stringMatching(/^hashed:/),
    }));
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "existing@example.com",
      subject: "Verifica tu cuenta de ERP",
    }));
  });

  it("does not resend when the supplied password does not match", async () => {
    mocks.verifyPassword.mockResolvedValue(false);

    const response = await POST(registrationRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Ya existe una cuenta con ese email." });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("returns a recoverable SMTP error when redelivery fails", async () => {
    const smtpError = Object.assign(new Error("SMTP connection failed"), {
      code: "ESOCKET",
      command: "CONN",
      host: "mail.example.com",
      reason: "Certificate hostname mismatch",
      cert: { raw: "large certificate payload" },
    });
    mocks.sendEmail.mockRejectedValue(smtpError);

    const response = await POST(registrationRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "La cuenta existe, pero no se pudo enviar el correo de verificación. Revisa la configuración SMTP e inténtalo de nuevo.",
    });
    expect(mocks.loggerError).toHaveBeenCalledWith({
      userId: "user-1",
      smtpError: {
        name: "Error",
        message: "SMTP connection failed",
        code: "ESOCKET",
        command: "CONN",
        host: "mail.example.com",
        reason: "Certificate hostname mismatch",
      },
    }, "auth.verification_email_delivery_failed");
  });
});
