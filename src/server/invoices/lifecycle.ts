/**
 * Ciclo de vida de facturas emitidas (código puro, también usable en cliente).
 *
 *   BORRADOR ──emitir──▶ EMITIDA (SENT) ──cobros──▶ PARCIAL / PAGADA
 *      │                    │
 *      └──anular──▶ ANULADA └──rectificativa (R1–R5)──▶ saldo ajustado
 *
 * - Un borrador es totalmente editable, no tiene número definitivo (usa un número provisional
 *   `BORRADOR-XXXXXXXX`), no genera asiento ni cuenta para modelos fiscales.
 * - Al emitir se asigna el número de la serie del ejercicio de la fecha de emisión, se congelan los
 *   datos fiscales de emisor y cliente y se contabiliza. Desde ese momento líneas, cliente, importes
 *   y fechas son inmutables: solo se pueden cambiar notas y formas de pago.
 * - Una factura emitida no se anula: se corrige con una factura rectificativa.
 *
 * Compatibilidad: antes de este ciclo todas las facturas se numeraban y contabilizaban al crearse
 * (aunque su estado fuera DRAFT). Por eso una factura se considera emitida si tiene `issuedAt` o si
 * su número no es provisional.
 */

export const DRAFT_NUMBER_PREFIX = "BORRADOR-";

export type InvoiceLifecycle = "DRAFT" | "ISSUED" | "VOID";
export type InvoiceType = "INVOICE" | "CREDIT_NOTE";
export type RectificationReason = "R1" | "R2" | "R3" | "R4" | "R5";
export type RectificationType = "DIFFERENCES" | "SUBSTITUTION";
export type SalesVatTreatmentCode = "DOMESTIC" | "INTRA_EU" | "EXPORT" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_SUBJECT";

export const RECTIFICATION_REASONS: RectificationReason[] = ["R1", "R2", "R3", "R4", "R5"];
export const RECTIFICATION_TYPES: RectificationType[] = ["DIFFERENCES", "SUBSTITUTION"];

/** Causas de rectificación (art. 15 RD 1619/2012 y claves VeriFactu/SII). */
export const rectificationReasonLabels: Record<RectificationReason, string> = {
  R1: "R1 · Error fundado en derecho o causas del art. 80.Uno, Dos y Seis LIVA",
  R2: "R2 · Concurso de acreedores del cliente (art. 80.Tres LIVA)",
  R3: "R3 · Crédito incobrable (art. 80.Cuatro LIVA)",
  R4: "R4 · Otras causas (errores, descuentos, devoluciones…)",
  R5: "R5 · Rectificación de factura simplificada",
};

export const rectificationTypeLabels: Record<RectificationType, string> = {
  DIFFERENCES: "Por diferencias",
  SUBSTITUTION: "Por sustitución",
};

export const salesVatTreatmentOptions: Array<{ value: SalesVatTreatmentCode; label: string; help: string }> = [
  { value: "DOMESTIC", label: "Nacional", help: "Operación en España con IVA." },
  { value: "INTRA_EU", label: "Intracomunitaria", help: "Entrega a empresa de otro país de la UE con NIF-IVA: sin IVA (art. 25 LIVA)." },
  { value: "EXPORT", label: "Exportación", help: "Cliente fuera de la UE: sin IVA (art. 21 LIVA)." },
  { value: "EXEMPT", label: "Exenta", help: "Operación exenta de IVA (art. 20 LIVA): sanidad, educación, seguros…" },
  { value: "REVERSE_CHARGE", label: "Inversión del sujeto pasivo", help: "El cliente liquida el IVA (art. 84.Uno.2º LIVA): obras, chatarra, etc." },
  { value: "NOT_SUBJECT", label: "No sujeta", help: "Operación no sujeta a IVA (p. ej. servicios localizados fuera de España)." },
];

/** Mención legal obligatoria en la factura según el tratamiento de IVA. */
export const vatTreatmentLegalNotes: Partial<Record<SalesVatTreatmentCode, string>> = {
  INTRA_EU: "Entrega intracomunitaria de bienes exenta de IVA (art. 25 Ley 37/1992 del IVA).",
  EXPORT: "Exportación exenta de IVA (art. 21 Ley 37/1992 del IVA).",
  EXEMPT: "Operación exenta de IVA (art. 20 Ley 37/1992 del IVA).",
  REVERSE_CHARGE: "Inversión del sujeto pasivo (art. 84.Uno.2º Ley 37/1992 del IVA).",
  NOT_SUBJECT: "Operación no sujeta a IVA (arts. 69 y 70 Ley 37/1992 del IVA).",
};

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "GR", "HR", "HU", "IE",
  "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/** Tratamiento por defecto según el país del cliente (ES → nacional, UE → intracomunitaria, resto → exportación). */
export function defaultSalesVatTreatment(countryCode: string | null | undefined): SalesVatTreatmentCode {
  const country = (countryCode ?? "ES").trim().toUpperCase() || "ES";
  if (country === "ES") return "DOMESTIC";
  return EU_COUNTRIES.has(country) ? "INTRA_EU" : "EXPORT";
}

export function isSalesVatTreatment(value: unknown): value is SalesVatTreatmentCode {
  return typeof value === "string" && salesVatTreatmentOptions.some((option) => option.value === value);
}

export function isDraftNumber(number: string | null | undefined) {
  return Boolean(number?.startsWith(DRAFT_NUMBER_PREFIX));
}

export function provisionalDraftNumber(randomId: string) {
  return `${DRAFT_NUMBER_PREFIX}${randomId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export function invoiceLifecycle(row: { status: string; number: string; issuedAt?: Date | string | null }): InvoiceLifecycle {
  if (row.status === "VOID") return "VOID";
  if (row.issuedAt) return "ISSUED";
  if (row.status === "DRAFT" && isDraftNumber(row.number)) return "DRAFT";
  return "ISSUED";
}

export const invoiceLifecycleLabels: Record<InvoiceLifecycle, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  VOID: "Anulada",
};

/** Saldo pendiente en céntimos: total + rectificativas emitidas (negativas) − cobros. Nunca negativo. */
export function outstandingCents(input: { totalCents: number; creditedCents: number; paidCents: number }) {
  return Math.max(input.totalCents + input.creditedCents - input.paidCents, 0);
}

/** Estado de cobro derivado de total, rectificaciones y cobros. */
export function derivePaymentStatus(input: { totalCents: number; creditedCents: number; paidCents: number }): "PENDING" | "PARTIAL" | "PAID" | "VOID" {
  const effective = input.totalCents + input.creditedCents;
  if (effective <= 0) return input.paidCents > 0 ? "PAID" : "VOID";
  if (input.paidCents >= effective) return "PAID";
  if (input.paidCents > 0) return "PARTIAL";
  return "PENDING";
}
