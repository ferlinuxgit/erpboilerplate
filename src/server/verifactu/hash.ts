import { createHash } from "node:crypto";

/**
 * Huella (hash) de los registros de facturación VeriFactu.
 *
 * Según "Especificaciones técnicas para la generación de la huella o hash de los registros de
 * facturación" (AEAT, v0.1.2) y el art. 13 de la Orden HAC/1177/2024:
 * - Algoritmo SHA-256 (TipoHuella 01) sobre la cadena UTF-8 de pares `campo=valor` unidos con `&`,
 *   en el orden fijado por la especificación.
 * - Los valores se toman sin espacios al principio ni al final; si un campo está vacío se incluye
 *   igualmente (`Huella=` en el primer registro de la cadena).
 * - Resultado en hexadecimal con mayúsculas (64 caracteres).
 */

export type AltaHashInput = {
  issuerTaxId: string;
  invoiceNumber: string;
  /** dd-mm-aaaa */
  invoiceIssueDate: string;
  invoiceTypeCode: string;
  /** Texto exacto de CuotaTotal (p. ej. "12.35"). */
  taxAmount: string;
  /** Texto exacto de ImporteTotal (p. ej. "123.45"). */
  totalAmount: string;
  /** Huella del registro anterior; vacío en el primer registro. */
  previousHash: string | null;
  /** FechaHoraHusoGenRegistro, p. ej. "2024-01-01T19:20:30+01:00". */
  generatedAtText: string;
};

export type AnulacionHashInput = {
  issuerTaxId: string;
  invoiceNumber: string;
  invoiceIssueDate: string;
  previousHash: string | null;
  generatedAtText: string;
};

const value = (input: string | null | undefined) => (input ?? "").trim();

function join(pairs: Array<[string, string | null | undefined]>) {
  return pairs.map(([key, raw]) => `${key}=${value(raw)}`).join("&");
}

export function buildAltaHashInput(input: AltaHashInput) {
  return join([
    ["IDEmisorFactura", input.issuerTaxId],
    ["NumSerieFactura", input.invoiceNumber],
    ["FechaExpedicionFactura", input.invoiceIssueDate],
    ["TipoFactura", input.invoiceTypeCode],
    ["CuotaTotal", input.taxAmount],
    ["ImporteTotal", input.totalAmount],
    ["Huella", input.previousHash],
    ["FechaHoraHusoGenRegistro", input.generatedAtText],
  ]);
}

export function buildAnulacionHashInput(input: AnulacionHashInput) {
  return join([
    ["IDEmisorFacturaAnulada", input.issuerTaxId],
    ["NumSerieFacturaAnulada", input.invoiceNumber],
    ["FechaExpedicionFacturaAnulada", input.invoiceIssueDate],
    ["Huella", input.previousHash],
    ["FechaHoraHusoGenRegistro", input.generatedAtText],
  ]);
}

export function sha256Upper(input: string) {
  return createHash("sha256").update(input, "utf8").digest("hex").toUpperCase();
}

export function computeAltaHash(input: AltaHashInput) {
  return sha256Upper(buildAltaHashInput(input));
}

export function computeAnulacionHash(input: AnulacionHashInput) {
  return sha256Upper(buildAnulacionHashInput(input));
}

/** Huella del registro de eventos (formato interno: la AEAT no recibe eventos en modo VERI*FACTU). */
export function computeEventHash(input: {
  companyId: string;
  sequence: number;
  eventType: string;
  description: string;
  payload: unknown;
  previousHash: string | null;
  generatedAtText: string;
}) {
  return sha256Upper(join([
    ["IDEmpresa", input.companyId],
    ["NumeroEvento", String(input.sequence)],
    ["TipoEvento", input.eventType],
    ["Descripcion", input.description],
    ["Datos", canonicalJson(input.payload ?? {})],
    ["HuellaEvento", input.previousHash],
    ["FechaHoraHusoGenEvento", input.generatedAtText],
  ]));
}

/** JSON con claves ordenadas: estable aunque Postgres (jsonb) reordene las claves al guardarlo. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export type StoredRecordForHash = {
  recordType: string;
  issuerTaxId: string;
  invoiceNumber: string;
  invoiceIssueDate: string;
  invoiceTypeCode: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
  previousHash: string | null;
  generatedAtText: string;
};

/** Recalcula la huella de un registro guardado (verificación de integridad). */
export function recomputeRecordHash(record: StoredRecordForHash) {
  if (record.recordType === "ANULACION") {
    return computeAnulacionHash(record);
  }
  return computeAltaHash({
    ...record,
    invoiceTypeCode: record.invoiceTypeCode ?? "",
    taxAmount: record.taxAmount ?? "",
    totalAmount: record.totalAmount ?? "",
  });
}
