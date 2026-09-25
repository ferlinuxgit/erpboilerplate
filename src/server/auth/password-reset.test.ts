import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { createSignedActionToken, hashAuthToken, verifySignedActionToken } from "@/lib/auth";
import { PASSWORD_RESET_TTL_MINUTES, requestPasswordReset, resetPassword, type PasswordResetStore } from "@/server/auth/password-reset";

/** In-memory store with the same single-use semantics as the Drizzle one. */
function memoryStore() {
  const users = new Map([["ana@example.com", { id: "user-1", name: "Ana", email: "ana@example.com" }]]);
  const tokens = new Map<string, { hash: string; expiresAt: Date }>();
  const passwords = new Map<string, string>();
  const store: PasswordResetStore = {
    findUserByEmail: vi.fn(async (email: string) => users.get(email) ?? null),
    replaceToken: vi.fn(async (userId: string, tokenHash: string, expiresAt: Date) => {
      tokens.set(userId, { hash: tokenHash, expiresAt });
    }),
    consumeTokenAndSetPassword: vi.fn(async (userId: string, tokenHash: string, passwordHash: string, now: Date) => {
      const stored = tokens.get(userId);
      if (!stored || stored.hash !== tokenHash || stored.expiresAt <= now) return false;
      tokens.delete(userId);
      passwords.set(userId, passwordHash);
      return true;
    }),
  };
  return { store, tokens, passwords };
}

const hashPassword = async (password: string) => `hashed:${password}`;

describe("signed action tokens", () => {
  it("round-trips the subject until it expires", () => {
    const now = Date.UTC(2026, 8, 25, 10);
    const token = createSignedActionToken("password-reset", "user-1", 60, now);
    expect(verifySignedActionToken("password-reset", token, now + 59_000)?.subject).toBe("user-1");
    expect(verifySignedActionToken("password-reset", token, now + 60_000)).toBeNull();
  });

  it("rejects tampered tokens and malformed input", () => {
    const token = createSignedActionToken("password-reset", "user-1", 60);
    const [body, signature] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ sub: "user-2", exp: 9_999_999_999, n: "x" })).toString("base64url");
    expect(verifySignedActionToken("password-reset", `${forgedBody}.${signature}`)).toBeNull();
    expect(verifySignedActionToken("password-reset", `${body}.${signature}x`)).toBeNull();
    expect(verifySignedActionToken("password-reset", `${token}.extra`)).toBeNull();
    expect(verifySignedActionToken("password-reset", "")).toBeNull();
    expect(verifySignedActionToken("password-reset", null)).toBeNull();
  });

  it("issues a different token every time", () => {
    expect(createSignedActionToken("password-reset", "user-1", 60)).not.toBe(createSignedActionToken("password-reset", "user-1", 60));
  });
});

describe("password reset lifecycle", () => {
  it("returns null (no token, no email) for unknown accounts", async () => {
    const { store } = memoryStore();
    await expect(requestPasswordReset("ghost@example.com", { store })).resolves.toBeNull();
    expect(store.replaceToken).not.toHaveBeenCalled();
  });

  it("stores only the hash of the token with the configured lifetime", async () => {
    const { store, tokens } = memoryStore();
    const now = Date.UTC(2026, 8, 25, 10);
    const issued = await requestPasswordReset("  ANA@example.com ", { store, now });
    expect(issued?.user.id).toBe("user-1");
    expect(tokens.get("user-1")?.hash).toBe(hashAuthToken(issued!.token));
    expect(tokens.get("user-1")?.hash).not.toBe(issued!.token);
    expect(tokens.get("user-1")?.expiresAt.getTime()).toBe(now + PASSWORD_RESET_TTL_MINUTES * 60_000);
  });

  it("changes the password once and rejects reusing the same link", async () => {
    const { store, passwords } = memoryStore();
    const issued = await requestPasswordReset("ana@example.com", { store });

    await expect(resetPassword(issued!.token, "NuevaClave123", { store, hashPassword })).resolves.toEqual({ status: "ok", userId: "user-1" });
    expect(passwords.get("user-1")).toBe("hashed:NuevaClave123");
    await expect(resetPassword(issued!.token, "OtraClave123", { store, hashPassword })).resolves.toEqual({ status: "invalid" });
    expect(passwords.get("user-1")).toBe("hashed:NuevaClave123");
  });

  it("invalidates the previous link when a new one is requested", async () => {
    const { store } = memoryStore();
    const first = await requestPasswordReset("ana@example.com", { store });
    const second = await requestPasswordReset("ana@example.com", { store });

    await expect(resetPassword(first!.token, "NuevaClave123", { store, hashPassword })).resolves.toEqual({ status: "invalid" });
    await expect(resetPassword(second!.token, "NuevaClave123", { store, hashPassword })).resolves.toEqual({ status: "ok", userId: "user-1" });
  });

  it("rejects expired links without touching the store", async () => {
    const { store } = memoryStore();
    const now = Date.UTC(2026, 8, 25, 10);
    const issued = await requestPasswordReset("ana@example.com", { store, now });

    const later = now + PASSWORD_RESET_TTL_MINUTES * 60_000 + 1_000;
    await expect(resetPassword(issued!.token, "NuevaClave123", { store, now: later, hashPassword })).resolves.toEqual({ status: "invalid" });
    expect(store.consumeTokenAndSetPassword).not.toHaveBeenCalled();
  });

  it("rejects forged tokens even if they look well formed", async () => {
    const { store } = memoryStore();
    await requestPasswordReset("ana@example.com", { store });
    const forged = `${Buffer.from(JSON.stringify({ sub: "user-1", exp: 9_999_999_999, n: "x" })).toString("base64url")}.bad-signature`;
    await expect(resetPassword(forged, "NuevaClave123", { store, hashPassword })).resolves.toEqual({ status: "invalid" });
    expect(store.consumeTokenAndSetPassword).not.toHaveBeenCalled();
  });
});
