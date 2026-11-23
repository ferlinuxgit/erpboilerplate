import { describe, expect, it } from "vitest";

import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpCodeAt, totpUri, verifyTotp } from "./totp";

// Vectores de la RFC 6238 (SHA-1, secreto ASCII "12345678901234567890"), últimos 6 dígitos.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("cumple los vectores de la RFC 6238", () => {
    expect(totpCodeAt(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpCodeAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCodeAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpCodeAt(RFC_SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("base32 ida y vuelta", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("acepta ±1 paso y rechaza códigos ya usados", () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, totpCodeAt(secret, step), { now })).toBe(step);
    expect(verifyTotp(secret, totpCodeAt(secret, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCodeAt(secret, step + 2), { now })).toBeNull();
    expect(verifyTotp(secret, totpCodeAt(secret, step), { now, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, "12a456", { now })).toBeNull();
  });

  it("URI otpauth y códigos de recuperación", () => {
    expect(totpUri({ secret: "ABC", account: "a@b.es", issuer: "ERP" })).toBe("otpauth://totp/ERP%3Aa%40b.es?secret=ABC&issuer=ERP&algorithm=SHA1&digits=6&period=30");
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(hashRecoveryCode(codes[0].toLowerCase().replace("-", " "))).toBe(hashRecoveryCode(codes[0]));
  });
});
