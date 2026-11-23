import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { verifactuRecord } from "@/db/schema";
import { db, type AppDb } from "@/lib/db";
import { appendEvent } from "@/server/verifactu/chain";
import { loadCompanyCredentials } from "@/server/verifactu/certificates";
import type { VerifactuCredentials, VerifactuTransport } from "@/server/verifactu/transport";
import { buildRegFactuSoapEnvelope, MAX_RECORDS_PER_SUBMISSION, parseAeatResponse, type AeatLineResult, type XmlRecord } from "@/server/verifactu/xml";

/**
 * Cola de envío VERI*FACTU (patrón del worker de OCR: arrendamiento + reintentos con espera creciente).
 *
 * 1. Se "arriendan" los registros pendientes de una empresa (FOR UPDATE SKIP LOCKED + nextAttemptAt
 *    en el futuro), en orden de encadenamiento.
 * 2. Se envían en un único mensaje RegFactuSistemaFacturacion (máx. 1.000 registros).
 * 3. Se actualiza el estado de cada registro con la respuesta. Solo se tocan columnas de estado:
 *    el trigger de inmutabilidad rechaza cualquier otro cambio.
 * Un error de red deja los registros PENDING_SEND con reintento diferido; un SOAP Fault provocado
 * por un registro concreto se aísla (ver `submitLeasedBatch`).
 */

const LEASE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
/** Código AEAT de registro duplicado: el registro ya consta en la AEAT (respuesta anterior perdida). */
const DUPLICATE_CODES = new Set(["3000"]);

export function retryDelayMs(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export type LineOutcome = { status: "ACCEPTED" | "ACCEPTED_WITH_ERRORS" | "REJECTED" | "SENT"; errorCode: string | null; errorMessage: string | null };

export function outcomeForLine(line: AeatLineResult | undefined): LineOutcome {
  if (!line) return { status: "SENT", errorCode: null, errorMessage: "La AEAT no devolvió resultado para este registro." };
  if (line.status === "Correcto") return { status: "ACCEPTED", errorCode: null, errorMessage: null };
  if (line.status === "AceptadoConErrores") return { status: "ACCEPTED_WITH_ERRORS", errorCode: line.errorCode, errorMessage: line.errorMessage };
  if (line.errorCode && DUPLICATE_CODES.has(line.errorCode)) return { status: "ACCEPTED", errorCode: line.errorCode, errorMessage: line.errorMessage };
  return { status: "REJECTED", errorCode: line.errorCode, errorMessage: line.errorMessage };
}

type LeasedRecord = typeof verifactuRecord.$inferSelect;

async function leaseCompanyBatch(client: AppDb, companyId: string, now: Date, limit: number): Promise<LeasedRecord[]> {
  return client.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(verifactuRecord)
      .where(and(
        eq(verifactuRecord.companyId, companyId),
        eq(verifactuRecord.status, "PENDING_SEND"),
        eq(verifactuRecord.mode, "VERIFACTU"),
        or(isNull(verifactuRecord.nextAttemptAt), lte(verifactuRecord.nextAttemptAt, now)),
      ))
      .orderBy(asc(verifactuRecord.sequence))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(verifactuRecord)
      .set({
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
        lastAttemptAt: now,
        sendAttempts: sql`${verifactuRecord.sendAttempts} + 1`,
      })
      .where(inArray(verifactuRecord.id, rows.map((row) => row.id)));
    return rows.map((row) => ({ ...row, sendAttempts: row.sendAttempts + 1 }));
  });
}

export type SubmissionSummary = { companyId: string; sent: number; accepted: number; rejected: number; failed: number; waitSeconds: number | null; error: string | null };

type AeatResponse = ReturnType<typeof parseAeatResponse>;
type SendAttempt = { ok: true; response: AeatResponse } | { ok: false; message: string; fault: boolean };

/** Un registro se considera remitido con incidencia si ya falló un envío o lleva más de una hora generado. */
const INCIDENT_AGE_MS = 60 * 60_000;
/** Envíos extra, como mucho, para aislar el registro que hace fallar un lote entero. */
const MAX_ISOLATION_SENDS = 24;

export function isIncidentBatch(records: Array<{ sendAttempts: number; generatedAt: Date }>, now: Date) {
  return records.some((record) => record.sendAttempts > 1 || now.getTime() - record.generatedAt.getTime() > INCIDENT_AGE_MS);
}

async function sendOnce(transport: VerifactuTransport, records: LeasedRecord[], credentials: VerifactuCredentials | null, now: Date): Promise<SendAttempt> {
  try {
    const envelope = buildRegFactuSoapEnvelope({
      issuer: { name: records[0].issuerName, taxId: records[0].issuerTaxId },
      records: records as XmlRecord[],
      incident: isIncidentBatch(records, now),
    });
    const result = await transport.send(envelope, credentials);
    const response = parseAeatResponse(result.body);
    if (response.fault) return { ok: false, message: response.fault, fault: true };
    if (result.httpStatus >= 400 && response.lines.length === 0) return { ok: false, message: `La AEAT respondió HTTP ${result.httpStatus}.`, fault: false };
    return { ok: true, response };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Error desconocido al enviar a la AEAT.", fault: false };
  }
}

/**
 * Envía un lote de registros ya arrendados de una empresa y guarda el resultado.
 *
 * Si la AEAT devuelve un SOAP Fault para el lote entero (un registro mal formado invalida todo el
 * mensaje), se parte el lote por la mitad hasta aislar el registro culpable: los demás se remiten
 * con normalidad y el culpable queda rechazado con el motivo, listo para subsanarse. Si nada del
 * lote llega a aceptarse el fallo es general (certificado, servicio caído) y todo queda pendiente.
 */
export async function submitLeasedBatch(
  client: AppDb,
  transport: VerifactuTransport,
  records: LeasedRecord[],
  now = new Date(),
  credentials: VerifactuCredentials | null = null,
): Promise<SubmissionSummary> {
  const companyId = records[0].companyId;
  const summary: SubmissionSummary = { companyId, sent: records.length, accepted: 0, rejected: 0, failed: 0, waitSeconds: null, error: null };
  const delivered: Array<{ records: LeasedRecord[]; response: AeatResponse }> = [];
  const failed: Array<{ records: LeasedRecord[]; message: string; fault: boolean }> = [];
  let isolationSends = 0;

  const attempt = async (group: LeasedRecord[]): Promise<void> => {
    const result = await sendOnce(transport, group, credentials, now);
    if (result.ok) {
      delivered.push({ records: group, response: result.response });
      return;
    }
    if (result.fault && group.length > 1 && isolationSends + 2 <= MAX_ISOLATION_SENDS) {
      isolationSends += 2;
      const middle = Math.ceil(group.length / 2);
      await attempt(group.slice(0, middle));
      await attempt(group.slice(middle));
      return;
    }
    failed.push({ records: group, message: result.message, fault: result.fault });
  };
  await attempt(records);

  await client.transaction(async (tx) => {
    for (const { records: group, response } of delivered) {
      if (response.waitSeconds !== null) summary.waitSeconds = Math.max(summary.waitSeconds ?? 0, response.waitSeconds);
      let accepted = 0;
      let rejected = 0;
      for (const record of group) {
        const operation = record.recordType === "ANULACION" ? "Anulacion" : "Alta";
        const line = response.lines.find((candidate) => candidate.invoiceNumber === record.invoiceNumber && (!candidate.operation || candidate.operation === operation));
        const outcome = outcomeForLine(line);
        if (outcome.status === "SENT") {
          // Sin línea de respuesta no se sabe si consta: se reintenta (si ya constaba, la AEAT lo dirá como duplicado).
          summary.failed += 1;
          await tx
            .update(verifactuRecord)
            .set({ nextAttemptAt: new Date(now.getTime() + retryDelayMs(record.sendAttempts)), aeatErrorMessage: outcome.errorMessage })
            .where(eq(verifactuRecord.id, record.id));
          continue;
        }
        if (outcome.status === "REJECTED") rejected += 1;
        else accepted += 1;
        await tx
          .update(verifactuRecord)
          .set({
            status: outcome.status,
            sentAt: now,
            nextAttemptAt: null,
            aeatCsv: response.csv,
            aeatErrorCode: outcome.errorCode,
            aeatErrorMessage: outcome.errorMessage?.slice(0, 1000) ?? null,
          })
          .where(eq(verifactuRecord.id, record.id));
      }
      summary.accepted += accepted;
      summary.rejected += rejected;
      await appendEvent(tx, {
        companyId,
        eventType: "SUBMISSION",
        description: `Envío a la AEAT: ${accepted} aceptado(s), ${rejected} rechazado(s) de ${group.length}.`,
        payload: { csv: response.csv, estadoEnvio: response.submissionStatus, records: group.map((record) => record.sequence) },
      }, now);
    }

    for (const { records: group, message, fault } of failed) {
      // Aislado: solo este registro falla mientras otros del mismo lote se aceptan → es el culpable.
      const isolated = fault && group.length === 1 && delivered.length > 0;
      if (isolated) {
        summary.rejected += 1;
        await tx
          .update(verifactuRecord)
          .set({ status: "REJECTED", sentAt: now, nextAttemptAt: null, aeatErrorCode: "SOAP", aeatErrorMessage: message.slice(0, 1000) })
          .where(eq(verifactuRecord.id, group[0].id));
      } else {
        summary.failed += group.length;
        for (const record of group) {
          await tx
            .update(verifactuRecord)
            .set({ nextAttemptAt: new Date(now.getTime() + retryDelayMs(record.sendAttempts)), aeatErrorMessage: message.slice(0, 1000) })
            .where(eq(verifactuRecord.id, record.id));
        }
      }
      summary.error ??= message;
      await appendEvent(tx, {
        companyId,
        eventType: "SUBMISSION_ERROR",
        description: isolated
          ? `La AEAT no admite el registro n.º ${group[0].sequence}: ${message.slice(0, 300)}`
          : `Error al enviar ${group.length} registro(s) a la AEAT: ${message.slice(0, 300)}`,
        payload: { records: group.map((record) => record.sequence) },
      }, now);
    }
  });
  return summary;
}

/** Procesa la cola: un lote por empresa con registros pendientes. Devuelve el resumen por empresa. */
export async function processPendingVerifactuRecords(options: {
  transport: VerifactuTransport;
  now?: Date;
  batchSize?: number;
  client?: AppDb;
  companyId?: string;
  /** Certificado de cada empresa (por defecto, el que haya subido). */
  credentialsFor?: (companyId: string) => Promise<VerifactuCredentials | null>;
}) {
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const batchSize = Math.min(options.batchSize ?? MAX_RECORDS_PER_SUBMISSION, MAX_RECORDS_PER_SUBMISSION);
  const companies = await client
    .selectDistinct({ companyId: verifactuRecord.companyId })
    .from(verifactuRecord)
    .where(and(
      eq(verifactuRecord.status, "PENDING_SEND"),
      eq(verifactuRecord.mode, "VERIFACTU"),
      or(isNull(verifactuRecord.nextAttemptAt), lte(verifactuRecord.nextAttemptAt, now)),
      options.companyId ? eq(verifactuRecord.companyId, options.companyId) : undefined,
    ));
  const summaries: SubmissionSummary[] = [];
  const credentialsFor = options.credentialsFor ?? ((companyId: string) => loadCompanyCredentials(client, companyId));
  for (const { companyId } of companies) {
    const credentials = await credentialsFor(companyId);
    // Sin certificado propio ni del sistema no hay con qué remitir: los registros siguen pendientes.
    if (!credentials && options.transport.requiresCredentials) continue;
    const leased = await leaseCompanyBatch(client, companyId, now, batchSize);
    if (leased.length === 0) continue;
    summaries.push(await submitLeasedBatch(client, options.transport, leased, now, credentials));
  }
  return summaries;
}
