import { describe, expect, it } from "vitest";

import { createMemoryRateLimiter, RATE_LIMIT_RULES, resolveRateLimitRule, tooManyRequestsResponse } from "@/lib/rate-limit";

const rule = { id: "test", limit: 3, windowMs: 60_000 };

describe("memory rate limiter", () => {
  it("blocks once the limit is reached and reports Retry-After", async () => {
    let now = 1_000_000_020_000;
    const limiter = createMemoryRateLimiter({ now: () => now });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await limiter.limit(rule, "203.0.113.1")).success).toBe(true);
    }
    const blocked = await limiter.limit(rule, "203.0.113.1");
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Otra IP tiene su propio cupo.
    expect((await limiter.limit(rule, "203.0.113.2")).success).toBe(true);

    // Sliding window: al inicio de la siguiente ventana la anterior aún pesa…
    now += 60_000 - (now % 60_000) + 1_000;
    expect((await limiter.limit(rule, "203.0.113.1")).success).toBe(false);
    // …pero se libera a medida que avanza.
    now += 50_000;
    expect((await limiter.limit(rule, "203.0.113.1")).success).toBe(true);
  });

  it("keeps buckets independent and supports reset (e.g. after a successful login)", async () => {
    const limiter = createMemoryRateLimiter({ now: () => 5_000 });
    const other = { ...rule, id: "other" };
    for (let attempt = 0; attempt < 3; attempt += 1) await limiter.limit(rule, "key");
    expect((await limiter.limit(rule, "key")).success).toBe(false);
    expect((await limiter.limit(other, "key")).success).toBe(true);
    await limiter.reset(rule, "key");
    expect((await limiter.limit(rule, "key")).success).toBe(true);
  });

  it("evicts old keys instead of growing without bound", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ now: () => now, maxKeys: 10 });
    for (let index = 0; index < 50; index += 1) {
      now += 1;
      await limiter.limit(rule, `ip-${index}`);
    }
    // La clave más antigua se descartó: vuelve a tener cupo completo.
    const result = await limiter.limit(rule, "ip-0");
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2);
  });
});

describe("rate limit buckets", () => {
  it("uses strict buckets for authentication endpoints and exempts the Stripe webhook", () => {
    expect(resolveRateLimitRule("/api/auth/login", "POST")).toBe(RATE_LIMIT_RULES.login);
    expect(resolveRateLimitRule("/api/auth/register", "POST")).toBe(RATE_LIMIT_RULES.register);
    expect(resolveRateLimitRule("/api/auth/verify-two-factor", "POST")).toBe(RATE_LIMIT_RULES.verifyTwoFactor);
    expect(resolveRateLimitRule("/api/invitations/abc/accept", "POST")).toBe(RATE_LIMIT_RULES.invitationAccept);
    expect(resolveRateLimitRule("/api/auth/forgot-password", "POST")).toBe(RATE_LIMIT_RULES.forgotPassword);
    expect(resolveRateLimitRule("/api/auth/reset-password", "POST")).toBe(RATE_LIMIT_RULES.resetPassword);
    expect(resolveRateLimitRule("/api/auth/resend-verification", "POST")).toBe(RATE_LIMIT_RULES.resendVerification);
    // Account recovery is limited more tightly than the generic API bucket, also per email.
    expect(RATE_LIMIT_RULES.forgotPassword.limit).toBeLessThan(RATE_LIMIT_RULES.api.limit);
    expect(RATE_LIMIT_RULES.forgotPasswordEmail).toMatchObject({ limit: 3, windowMs: 60 * 60_000 });
    expect(RATE_LIMIT_RULES.resendVerificationEmail).toMatchObject({ limit: 3, windowMs: 60 * 60_000 });
    expect(resolveRateLimitRule("/api/invoices", "GET")).toBe(RATE_LIMIT_RULES.api);
    expect(resolveRateLimitRule("/api/billing/webhook", "POST")).toBeNull();
    expect(RATE_LIMIT_RULES.login.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMIT_RULES.loginEmail).toMatchObject({ limit: 5, windowMs: 15 * 60_000 });
  });

  it("answers 429 with Retry-After and a Spanish message", async () => {
    const response = tooManyRequestsResponse({ success: false, limit: 10, remaining: 0, resetAt: 0, retryAfterSeconds: 42 });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining("Espera 42 segundos"), retryAfter: 42 });
  });
});
