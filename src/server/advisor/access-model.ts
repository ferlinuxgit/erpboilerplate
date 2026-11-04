import { randomInt } from "node:crypto";

/**
 * Reglas del acceso del asesor sin base de datos (probadas en `access-model.test.ts`).
 */

export type AdvisorAccessState = {
  revokedAt: Date | null;
  expiresAt: Date | null;
  credentialsChangedAt: Date;
};

export type AdvisorAccessStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export function advisorAccessStatus(access: Pick<AdvisorAccessState, "revokedAt" | "expiresAt">, now = new Date()): AdvisorAccessStatus {
  if (access.revokedAt) return "REVOKED";
  if (access.expiresAt && access.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "ACTIVE";
}

export const advisorAccessStatusLabels: Record<AdvisorAccessStatus, string> = {
  ACTIVE: "Activo",
  REVOKED: "Revocado",
  EXPIRED: "Caducado",
};

/**
 * Una sesión vale para un acceso si el acceso está activo y la sesión se abrió después del último
 * cambio de credenciales (contraseña o secciones): cambiar la contraseña expulsa al asesor.
 */
export function isAccessUsableForSession(access: AdvisorAccessState, sessionCreatedAt: Date, now = new Date()) {
  return advisorAccessStatus(access, now) === "ACTIVE" && access.credentialsChangedAt.getTime() <= sessionCreatedAt.getTime();
}

/** Sin caracteres que se confunden al dictarla o copiarla a mano (0/O, 1/l/I). */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Contraseña aleatoria legible, en bloques de 4 separados por guiones (p. ej. `Xk7p-M2qa-9VtR-hb4E`). */
export function generateAdvisorPassword(blocks = 4) {
  const parts: string[] = [];
  for (let block = 0; block < blocks; block += 1) {
    let part = "";
    for (let index = 0; index < 4; index += 1) part += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    parts.push(part);
  }
  return parts.join("-");
}

export function normalizeAdvisorEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Duración de la sesión del portal (jornada de trabajo). */
export const ADVISOR_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
