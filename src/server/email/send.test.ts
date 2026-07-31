import { afterEach, describe, expect, it, vi } from "vitest";

const mailMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mailMocks.createTransport,
  },
}));

import { getSmtpConfig, isEmailDeliveryConfigured, sendEmail } from "./send";

const smtpEnvKeys = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL",
] as const;

const originalEnv = Object.fromEntries(smtpEnvKeys.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of smtpEnvKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("SMTP email configuration", () => {
  it("builds an authenticated STARTTLS-compatible configuration", () => {
    expect(getSmtpConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "mailer@example.com",
      SMTP_PASSWORD: "secret",
      SMTP_FROM_EMAIL: "ERP <mailer@example.com>",
    })).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      from: "ERP <mailer@example.com>",
      auth: { user: "mailer@example.com", pass: "secret" },
    });
  });

  it("infers implicit TLS for port 465 and supports SMTP without authentication", () => {
    expect(getSmtpConfig({
      SMTP_HOST: "mail.internal",
      SMTP_PORT: "465",
      SMTP_FROM_EMAIL: "ERP <erp@example.com>",
    })).toEqual({
      host: "mail.internal",
      port: 465,
      secure: true,
      from: "ERP <erp@example.com>",
    });
  });

  it("rejects invalid ports, secure values and partial credentials", () => {
    const base = { SMTP_HOST: "smtp.example.com", SMTP_FROM_EMAIL: "ERP <erp@example.com>" };

    expect(getSmtpConfig({ ...base, SMTP_PORT: "invalid" })).toBeNull();
    expect(getSmtpConfig({ ...base, SMTP_SECURE: "yes" })).toBeNull();
    expect(getSmtpConfig({ ...base, SMTP_USER: "mailer@example.com" })).toBeNull();
  });

  it("delivers a message through the configured SMTP transport", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = "mailer@example.com";
    process.env.SMTP_PASSWORD = "secret";
    process.env.SMTP_FROM_EMAIL = "ERP <mailer@example.com>";
    mailMocks.createTransport.mockReturnValue({ sendMail: mailMocks.sendMail });
    mailMocks.sendMail.mockResolvedValue({ messageId: "message-1" });

    expect(isEmailDeliveryConfigured()).toBe(true);
    await expect(sendEmail({
      to: "user@example.com",
      subject: "Bienvenido",
      html: "<p>Hola</p>",
    })).resolves.toEqual({ messageId: "message-1" });

    expect(mailMocks.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "mailer@example.com", pass: "secret" },
    });
    expect(mailMocks.sendMail).toHaveBeenCalledWith({
      from: "ERP <mailer@example.com>",
      to: "user@example.com",
      subject: "Bienvenido",
      html: "<p>Hola</p>",
    });
  });

  it("skips delivery without SMTP only outside production", async () => {
    for (const key of smtpEnvKeys) delete process.env[key];
    vi.stubEnv("NODE_ENV", "development");

    await expect(sendEmail({ to: "user@example.com", subject: "Test", html: "<p>Test</p>" }))
      .resolves.toEqual({ id: "noop", skipped: true });
    expect(mailMocks.createTransport).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "production");
    await expect(sendEmail({ to: "user@example.com", subject: "Test", html: "<p>Test</p>" }))
      .rejects.toThrow("El servicio de correo no está configurado.");
  });
});
