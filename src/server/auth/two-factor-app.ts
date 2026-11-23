import QRCode from "qrcode";
import { and, eq, isNotNull, isNull, or, lt, sql } from "drizzle-orm";

import { user } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { decryptSecret, encryptSecret } from "@/server/bank-connections/crypto";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, normalizeRecoveryCode, totpUri, verifyTotp } from "@/server/auth/totp";

/**
 * Verificación en dos pasos con app de autenticación. El secreto se guarda cifrado (AES-GCM con
 * una clave derivada de TOTP_ENCRYPTION_KEY o JWT_SECRET); mientras no se confirma con un código
 * queda pendiente (`totpEnabledAt` nulo) y no cambia el inicio de sesión.
 */

const ISSUER = "ERP";

function encryptionSecret() {
  const secret = process.env.TOTP_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!secret) throw new HttpError(503, "La verificación con app no está configurada en este servidor.");
  return `totp:${secret}`;
}

async function loadTotp(userId: string) {
  const [row] = await db
    .select({ email: user.email, secret: user.totpSecretEncrypted, enabledAt: user.totpEnabledAt, lastStep: user.totpLastStep, recovery: user.totpRecoveryHashes })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) throw new HttpError(404, "Usuario no encontrado.");
  return row;
}

export async function getTotpStatus(userId: string) {
  const row = await loadTotp(userId);
  return { enabled: Boolean(row.enabledAt && row.secret), enabledAt: row.enabledAt, recoveryCodesLeft: row.enabledAt ? row.recovery.length : 0 };
}

export async function userHasTotp(userId: string) {
  const [row] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, userId), isNotNull(user.totpEnabledAt), isNotNull(user.totpSecretEncrypted))).limit(1);
  return Boolean(row);
}

/** Paso 1: secreto nuevo (pendiente) y su QR para escanearlo con la app. */
export async function startTotpSetup(userId: string) {
  const row = await loadTotp(userId);
  if (row.enabledAt) throw new HttpError(409, "La verificación con app ya está activada. Desactívala antes de configurarla de nuevo.");
  const secret = generateTotpSecret();
  await db.update(user).set({ totpSecretEncrypted: encryptSecret(secret, encryptionSecret()), totpLastStep: null, updatedAt: new Date() }).where(eq(user.id, userId));
  const uri = totpUri({ secret, account: row.email, issuer: ISSUER });
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  return { secret, uri, qrDataUrl };
}

/** Paso 2: se confirma con un código de la app; devuelve los códigos de recuperación (solo esta vez). */
export async function enableTotp(userId: string, code: string) {
  const row = await loadTotp(userId);
  if (row.enabledAt) throw new HttpError(409, "La verificación con app ya está activada.");
  if (!row.secret) throw new HttpError(400, "Empieza la configuración de nuevo.");
  const step = verifyTotp(decryptSecret(row.secret, encryptionSecret()), code);
  if (step === null) throw new HttpError(400, "El código no es correcto. Comprueba la hora del móvil y prueba con el siguiente.");
  const recoveryCodes = generateRecoveryCodes();
  await db
    .update(user)
    .set({ totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryHashes: recoveryCodes.map(hashRecoveryCode), updatedAt: new Date() })
    .where(and(eq(user.id, userId), isNull(user.totpEnabledAt)));
  return { recoveryCodes };
}

/**
 * Comprueba el segundo factor de un usuario con TOTP: un código de la app (que no se haya usado ya)
 * o un código de recuperación (se gasta). Atómico frente a peticiones simultáneas.
 */
export async function verifyUserSecondFactor(userId: string, rawCode: string): Promise<"totp" | "recovery" | null> {
  const row = await loadTotp(userId);
  if (!row.enabledAt || !row.secret) return null;
  const code = rawCode.trim();
  if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
    const step = verifyTotp(decryptSecret(row.secret, encryptionSecret()), code, { lastStep: row.lastStep });
    if (step === null) return null;
    const [updated] = await db
      .update(user)
      .set({ totpLastStep: step })
      .where(and(eq(user.id, userId), or(isNull(user.totpLastStep), lt(user.totpLastStep, step))))
      .returning({ id: user.id });
    return updated ? "totp" : null;
  }
  if (normalizeRecoveryCode(code).length !== 10) return null;
  const hash = hashRecoveryCode(code);
  const [updated] = await db
    .update(user)
    .set({ totpRecoveryHashes: sql`${user.totpRecoveryHashes} - ${hash}::text` })
    .where(and(eq(user.id, userId), sql`${user.totpRecoveryHashes} ? ${hash}::text`))
    .returning({ id: user.id });
  return updated ? "recovery" : null;
}

/** Desactivar o generar códigos nuevos exige un código válido (de la app o de recuperación). */
async function requireSecondFactor(userId: string, code: string) {
  if (!(await verifyUserSecondFactor(userId, code))) throw new HttpError(400, "El código no es correcto.");
}

export async function disableTotp(userId: string, code: string) {
  await requireSecondFactor(userId, code);
  await db.update(user).set({ totpSecretEncrypted: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [], updatedAt: new Date() }).where(eq(user.id, userId));
}

export async function regenerateRecoveryCodes(userId: string, code: string) {
  await requireSecondFactor(userId, code);
  const recoveryCodes = generateRecoveryCodes();
  await db.update(user).set({ totpRecoveryHashes: recoveryCodes.map(hashRecoveryCode), updatedAt: new Date() }).where(eq(user.id, userId));
  return { recoveryCodes };
}
