import { sepaId } from "@/server/sepa/pain001";
import type { SequenceType } from "@/server/sepa/pain008";

/*
 * Reglas puras de los adeudos directos SEPA CORE (sin base de datos), para poder probarlas.
 */

export type MandateType = "RECURRENT" | "ONE_OFF";
export type MandateStatus = "ACTIVE" | "REVOKED";

/** Un mandato sin adeudos durante 36 meses caduca (Rulebook SEPA CORE). */
export const MANDATE_EXPIRY_MONTHS = 36;

export type MandateState = {
  mandateType: string;
  status: string;
  collectionCount: number;
  signatureDate: Date;
  lastCollectionAt: Date | null;
};

/** Fecha en que caduca el mandato por falta de uso (36 meses desde el último adeudo o la firma). */
export function mandateExpiresAt(mandate: Pick<MandateState, "signatureDate" | "lastCollectionAt">) {
  const base = new Date(mandate.lastCollectionAt ?? mandate.signatureDate);
  base.setUTCMonth(base.getUTCMonth() + MANDATE_EXPIRY_MONTHS);
  return base;
}

/** Motivo (en lenguaje llano) por el que no se puede usar el mandato, o null si se puede. */
export function mandateUnusableReason(mandate: MandateState, collectionDate: Date, pendingUses = 0) {
  if (mandate.status !== "ACTIVE") return "El mandato está revocado.";
  if (mandate.signatureDate.getTime() > collectionDate.getTime()) return "El mandato se firmó después de la fecha de cobro.";
  if (mandateExpiresAt(mandate).getTime() < collectionDate.getTime()) {
    return "El mandato ha caducado (36 meses sin adeudos): pide al cliente que firme uno nuevo.";
  }
  if (mandate.mandateType === "ONE_OFF" && mandate.collectionCount + pendingUses > 0) return "El mandato era para un único adeudo y ya se ha usado.";
  return null;
}

/**
 * Secuencia del siguiente adeudo de un mandato. `pendingUses` son los adeudos del mismo mandato
 * que ya están en remesas generadas (o antes en la misma remesa) y todavía no se han cobrado.
 */
export function nextSequenceType(mandate: Pick<MandateState, "mandateType" | "collectionCount">, pendingUses = 0): SequenceType {
  if (mandate.mandateType === "ONE_OFF") return "OOFF";
  return mandate.collectionCount + pendingUses === 0 ? "FRST" : "RCUR";
}

/** Cambios en el mandato al cobrar (+1) o deshacer/devolver (−1) un adeudo con esa secuencia. */
export function mandateAfterCollection(
  mandate: { collectionCount: number; firstCollectionAt: Date | null; lastCollectionAt: Date | null; status: string },
  sequenceType: SequenceType,
  direction: 1 | -1,
  collectionDate: Date,
  now: Date,
) {
  const collectionCount = Math.max(mandate.collectionCount + direction, 0);
  const closes = sequenceType === "OOFF" || sequenceType === "FNAL";
  return {
    collectionCount,
    firstCollectionAt: collectionCount === 0 ? null : mandate.firstCollectionAt ?? collectionDate,
    lastCollectionAt: direction === 1 ? collectionDate : collectionCount === 0 ? null : mandate.lastCollectionAt,
    status: closes ? (direction === 1 ? "REVOKED" : "ACTIVE") : mandate.status,
    revokedAt: closes ? (direction === 1 ? now : null) : undefined,
  };
}

/** Primer día de cobro admitido: el siguiente día hábil (CORE exige presentar con D-1 hábil). */
export function earliestCollectionDate(now: Date) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

/** Referencia de mandato propuesta: "MDT-<cliente>-<AAAAMMDD>-<aleatorio>" (máx. 35, juego SEPA). */
export function proposeMandateReference(customerCode: string, now: Date, random = crypto.randomUUID()) {
  const code = sepaId(customerCode).toUpperCase().slice(0, 12) || "CLIENTE";
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return sepaId(`MDT-${code}-${stamp}-${random.replace(/-/g, "").slice(0, 4).toUpperCase()}`);
}

/** Referencia de mandato válida: 1-35 caracteres del juego SEPA sin espacios. */
export function isValidMandateReference(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 35 && /^[A-Za-z0-9/\-?:().,'+]+$/.test(trimmed);
}
