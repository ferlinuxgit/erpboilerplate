import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Verificación en dos pasos con app (Google Authenticator, 1Password, Authy…): TOTP de RFC 6238
 * con HMAC-SHA1, pasos de 30 s y 6 dígitos, que es lo que entienden todas las apps.
 */

export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Secreto base32 no válido.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** Secreto nuevo de 160 bits (lo recomendado por la RFC 4226), en base32. */
export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()) {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCodeAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Comprueba un código admitiendo un paso de desfase de reloj (±30 s). Devuelve el paso que casó
 * o null. Un paso ya usado (`lastStep`) o anterior no vale: el mismo código no sirve dos veces.
 */
export function verifyTotp(secret: string, code: string, options: { now?: number; lastStep?: number | null } = {}) {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const current = totpStep(options.now);
  for (const step of [current - 1, current, current + 1]) {
    if (options.lastStep != null && step <= options.lastStep) continue;
    const expected = Buffer.from(totpCodeAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

export function totpUri(input: { secret: string; account: string; issuer: string }) {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Códigos de recuperación: 10 de 10 caracteres (XXXXX-XXXXX), se guardan solo sus hashes. */
export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(`totp-recovery:${normalizeRecoveryCode(code)}`).digest("hex");
}
