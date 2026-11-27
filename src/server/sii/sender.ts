/**
 * Envío de la bandeja de salida del SII: agrupa los registros pendientes de cada empresa por
 * libro y tipo de comunicación (un mensaje SOAP solo admite un TipoComunicacion), los envía con
 * el certificado de la empresa y anota el resultado de cada línea de la respuesta.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { siiRecord } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { cancellationFor } from "@/server/sii/mapping";
import { loadSiiCompanyProfile, siiEligibility } from "@/server/sii/outbox";
import type { SiiTransport } from "@/server/sii/transport";
import type { SiiBook, SiiOperation, SiiRecordPayload, SiiStatus } from "@/server/sii/types";
import {
  buildBajaLRFacturasEmitidas,
  buildBajaLRFacturasRecibidas,
  buildSoapEnvelope,
  buildSuministroLRFacturasEmitidas,
  buildSuministroLRFacturasRecibidas,
  chunkForSubmission,
  parseSiiResponse,
  type SiiLineResult,
  type SiiSubmissionResponse,
} from "@/server/sii/xml";
import { loadCompanyCredentials } from "@/server/verifactu/certificates";
import { isValidIssuerNifFormat, normalizeIssuerNif } from "@/server/verifactu/format";

/** Marcas internas (no son códigos de la AEAT) de un envío que no llegó a tener respuesta por línea. */
export const SII_TRANSPORT_ERROR = "TRANSPORTE";
export const SII_FAULT_ERROR = "FAULT";

/** Un registro en envío no se vuelve a tomar hasta pasado este tiempo (otro proceso puede estar enviándolo). */
const LEASE_MS = 3 * 60_000;

/** Espera antes de reintentar un envío fallido: 5 min, 10, 20… hasta 6 horas. */
export function retryDelayMs(attempts: number) {
  return Math.min(5 * 60_000 * 2 ** Math.max(attempts - 1, 0), 6 * 60 * 60_000);
}

export type SiiLineOutcome = { status: SiiStatus; errorCode: string | null; errorMessage: string | null; csv: string | null };

/** Códigos de la lista de errores del SII que tienen un tratamiento propio. */
export const SII_ERROR_DUPLICATE = "3000"; // Factura duplicada
export const SII_ERROR_ALREADY_CANCELLED = "3001"; // El registro está ya dado de baja

/**
 * Estado de un registro según su línea de la respuesta.
 * - Correcto → aceptado. AceptadoConErrores → aceptado con errores (hay que corregirlo con una modificación).
 * - Incorrecto → rechazado, con su código y descripción. Una factura duplicada (3000) se rechaza
 *   igual, pero el mensaje explica que ya consta y que se puede reenviar como modificación.
 * - Una baja de un registro ya dado de baja (3001) está conseguida: se da por aceptada.
 * - Sin línea: aceptado si el envío entero fue correcto; si no, «enviado» a la espera de aclararlo.
 */
export function outcomeForLine(line: SiiLineResult | undefined, response: Pick<SiiSubmissionResponse, "csv" | "submissionStatus">, operation: SiiOperation): SiiLineOutcome {
  if (!line) {
    return response.submissionStatus === "Correcto"
      ? { status: "ACCEPTED", errorCode: null, errorMessage: null, csv: response.csv }
      : { status: "SENT", errorCode: null, errorMessage: "La AEAT no devolvió el resultado de este registro. Consulta su estado en la sede antes de reenviarlo.", csv: response.csv };
  }
  const csv = line.csv ?? response.csv;
  if (line.status === "Correcto") return { status: "ACCEPTED", errorCode: null, errorMessage: null, csv };
  if (line.status === "AceptadoConErrores") return { status: "ACCEPTED_WITH_ERRORS", errorCode: line.errorCode, errorMessage: line.errorMessage, csv };
  if (operation === "BAJA" && line.errorCode === SII_ERROR_ALREADY_CANCELLED) return { status: "ACCEPTED", errorCode: line.errorCode, errorMessage: line.errorMessage, csv };
  if (line.errorCode === SII_ERROR_DUPLICATE) {
    return {
      status: "REJECTED",
      errorCode: line.errorCode,
      errorMessage: `${line.errorMessage ?? "Factura duplicada"}. La factura ya consta en el SII${line.duplicateStatus ? ` (estado: ${line.duplicateStatus})` : ""}: pulsa «Reenviar» para comunicarla como modificación.`,
      csv,
    };
  }
  return { status: "REJECTED", errorCode: line.errorCode, errorMessage: line.errorMessage ?? "Registro rechazado por la AEAT.", csv };
}

type RecordRow = typeof siiRecord.$inferSelect;

/** Línea de la respuesta que corresponde a un registro: por la referencia propia o, si no viene, por número y fecha. */
export function findLine(lines: SiiLineResult[], record: Pick<RecordRow, "id" | "invoiceNumber" | "invoiceDate">) {
  return lines.find((line) => line.refExterna === record.id)
    ?? lines.find((line) => !line.refExterna && line.invoiceNumber === record.invoiceNumber && (!line.issueDate || line.issueDate === record.invoiceDate));
}

export function buildSubmissionXml(input: { holder: { name: string; nif: string }; book: SiiBook; operation: SiiOperation; records: Array<Pick<RecordRow, "id" | "payload">> }) {
  const payloads = input.records.map((record) => ({ id: record.id, payload: record.payload as unknown as SiiRecordPayload }));
  if (input.operation === "BAJA") {
    const cancellations = payloads.map(({ id, payload }) => ({ ...cancellationFor(payload), refExterna: id }));
    return buildSoapEnvelope(input.book === "ISSUED"
      ? buildBajaLRFacturasEmitidas({ holder: input.holder, cancellations })
      : buildBajaLRFacturasRecibidas({ holder: input.holder, cancellations }));
  }
  if (input.book === "ISSUED") {
    const invoices = payloads.flatMap(({ id, payload }) => (payload.book === "ISSUED" ? [{ ...payload.invoice, refExterna: id }] : []));
    return buildSoapEnvelope(buildSuministroLRFacturasEmitidas({ holder: input.holder, communication: input.operation, invoices }));
  }
  const invoices = payloads.flatMap(({ id, payload }) => (payload.book === "RECEIVED" ? [{ ...payload.invoice, refExterna: id }] : []));
  return buildSoapEnvelope(buildSuministroLRFacturasRecibidas({ holder: input.holder, communication: input.operation, invoices }));
}

export type SiiSubmissionSummary = {
  companyId: string;
  sent: number;
  accepted: number;
  acceptedWithErrors: number;
  rejected: number;
  /** Registros que siguen pendientes porque el envío falló (se reintentará). */
  failed: number;
  error: string | null;
};

async function failBatch(client: DbClient, records: RecordRow[], code: string, message: string, now: Date) {
  for (const record of records) {
    await client
      .update(siiRecord)
      .set({ nextAttemptAt: new Date(now.getTime() + retryDelayMs(record.attempts)), aeatErrorCode: code, aeatErrorMessage: message.slice(0, 500), updatedAt: now })
      .where(and(eq(siiRecord.id, record.id), eq(siiRecord.status, "PENDING")));
  }
}

async function submitBatch(client: DbClient, transport: SiiTransport, credentials: Awaited<ReturnType<typeof loadCompanyCredentials>>, holder: { name: string; nif: string }, book: SiiBook, operation: SiiOperation, records: RecordRow[], summary: SiiSubmissionSummary, now: Date) {
  let response: SiiSubmissionResponse;
  let httpStatus = 0;
  try {
    const xml = buildSubmissionXml({ holder, book, operation, records });
    const result = await transport.send(xml, { book, environment: transport.environment }, credentials);
    httpStatus = result.httpStatus;
    response = parseSiiResponse(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de conexión con la AEAT.";
    await failBatch(client, records, SII_TRANSPORT_ERROR, message, now);
    summary.failed += records.length;
    summary.error = message;
    return;
  }
  if (response.fault || !response.submissionStatus) {
    // Rechazo del envío completo (esquema, cabecera, certificado no autorizado…) o respuesta que
    // no es del servicio: nada se ha registrado. Los registros siguen pendientes y, a partir de
    // ahora, se envían de uno en uno para aislar al que provoca el fallo.
    const message = response.fault
      ? `La AEAT ha rechazado el envío completo: ${response.fault}`
      : `Respuesta inesperada de la AEAT (HTTP ${httpStatus}).`;
    await failBatch(client, records, SII_FAULT_ERROR, message, now);
    summary.failed += records.length;
    summary.error = message;
    return;
  }
  for (const record of records) {
    const outcome = outcomeForLine(findLine(response.lines, record), response, operation);
    await client
      .update(siiRecord)
      .set({ status: outcome.status, aeatCsv: outcome.csv, aeatErrorCode: outcome.errorCode, aeatErrorMessage: outcome.errorMessage?.slice(0, 600) ?? null, sentAt: now, nextAttemptAt: null, updatedAt: now })
      .where(and(eq(siiRecord.id, record.id), eq(siiRecord.status, "PENDING")));
    summary.sent += 1;
    if (outcome.status === "ACCEPTED") summary.accepted += 1;
    else if (outcome.status === "ACCEPTED_WITH_ERRORS") summary.acceptedWithErrors += 1;
    else if (outcome.status === "REJECTED") summary.rejected += 1;
  }
}

/** Envía lo pendiente (del entorno del transporte) de una empresa o de todas las que tienen algo que enviar. */
export async function processPendingSiiRecords(options: { transport: SiiTransport; companyId?: string; client?: DbClient; now?: Date }): Promise<SiiSubmissionSummary[]> {
  const client = options.client ?? db;
  const { transport } = options;
  const now = options.now ?? new Date();
  const sendable = and(
    eq(siiRecord.status, "PENDING"),
    eq(siiRecord.environment, transport.environment),
    isNull(siiRecord.blockedReason),
    or(isNull(siiRecord.nextAttemptAt), lte(siiRecord.nextAttemptAt, now)),
    or(isNull(siiRecord.lastAttemptAt), lte(siiRecord.lastAttemptAt, new Date(now.getTime() - LEASE_MS))),
    ...(options.companyId ? [eq(siiRecord.companyId, options.companyId)] : []),
  );
  const companies = await client.selectDistinct({ companyId: siiRecord.companyId }).from(siiRecord).where(sendable);
  const summaries: SiiSubmissionSummary[] = [];

  for (const { companyId } of companies) {
    const summary: SiiSubmissionSummary = { companyId, sent: 0, accepted: 0, acceptedWithErrors: 0, rejected: 0, failed: 0, error: null };
    summaries.push(summary);
    const profile = await loadSiiCompanyProfile(client, companyId);
    const eligibility = profile ? siiEligibility(profile) : null;
    if (!profile || !eligibility?.supported) {
      summary.error = eligibility?.reason ?? "Empresa no encontrada.";
      continue;
    }
    const nif = normalizeIssuerNif(profile.vatNumber);
    if (!isValidIssuerNifFormat(nif)) {
      summary.error = "La empresa no tiene un NIF válido: complétalo en Configuración › Empresa.";
      continue;
    }
    let credentials: Awaited<ReturnType<typeof loadCompanyCredentials>> = null;
    try {
      credentials = await loadCompanyCredentials(client, companyId);
    } catch {
      summary.error = "No se ha podido leer el certificado electrónico de la empresa. Vuelve a subirlo en Configuración › Fiscalidad.";
      continue;
    }
    if (!credentials && transport.requiresCredentials) {
      summary.error = "La empresa no tiene certificado electrónico: súbelo en Configuración › Fiscalidad (es el mismo que usa VERI*FACTU).";
      continue;
    }
    if (credentials?.validTo && credentials.validTo.getTime() < now.getTime()) {
      summary.error = "El certificado electrónico de la empresa ha caducado: sube uno vigente en Configuración › Fiscalidad.";
      continue;
    }

    // Se toman los registros (marcando el intento) para que dos procesos no envíen lo mismo a la vez.
    const candidates = await client.select({ id: siiRecord.id }).from(siiRecord).where(and(sendable, eq(siiRecord.companyId, companyId))).orderBy(asc(siiRecord.createdAt));
    const leased: RecordRow[] = [];
    for (const ids of chunkForSubmission(candidates.map((row) => row.id), 1000)) {
      leased.push(...await client
        .update(siiRecord)
        .set({ lastAttemptAt: now, attempts: sql`${siiRecord.attempts} + 1` })
        .where(and(sendable, inArray(siiRecord.id, ids)))
        .returning());
    }
    leased.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    const holder = { name: profile.name, nif };
    const groups = new Map<string, RecordRow[]>();
    for (const record of leased) {
      // Tras un rechazo del envío completo, cada registro viaja solo: así se sabe cuál lo provoca.
      const key = record.aeatErrorCode === SII_FAULT_ERROR ? `${record.book}|${record.operation}|${record.id}` : `${record.book}|${record.operation}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    for (const [key, records] of groups) {
      const [book, operation] = key.split("|") as [SiiBook, SiiOperation];
      for (const batch of chunkForSubmission(records)) {
        await submitBatch(client, transport, credentials, holder, book, operation, batch, summary, now);
      }
    }
  }
  return summaries;
}
