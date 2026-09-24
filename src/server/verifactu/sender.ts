import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { verifactuRecord } from "@/db/schema";
import { db, type AppDb } from "@/lib/db";
import { appendEvent } from "@/server/verifactu/chain";
import type { VerifactuTransport } from "@/server/verifactu/transport";
import { buildRegFactuSoapEnvelope, MAX_RECORDS_PER_SUBMISSION, parseAeatResponse, type AeatLineResult, type XmlRecord } from "@/server/verifactu/xml";

/**
 * Cola de envío VERI*FACTU (patrón del worker de OCR: arrendamiento + reintentos con espera creciente).
 *
 * 1. Se "arriendan" los registros pendientes de una empresa (FOR UPDATE SKIP LOCKED + nextAttemptAt
 *    en el futuro), en orden de encadenamiento.
 * 2. Se envían en un único mensaje RegFactuSistemaFacturacion (máx. 1.000 registros).
 * 3. Se actualiza el estado de cada registro con la respuesta. Solo se tocan columnas de estado:
 *    el trigger de inmutabilidad rechaza cualquier otro cambio.
 * Un error de red o un SOAP Fault deja los registros PENDING_SEND con reintento diferido.
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

/** Envía un lote de registros ya arrendados de una empresa y guarda el resultado. */
export async function submitLeasedBatch(client: AppDb, transport: VerifactuTransport, records: LeasedRecord[], now = new Date()): Promise<SubmissionSummary> {
  const companyId = records[0].companyId;
  const issuer = { name: records[0].issuerName, taxId: records[0].issuerTaxId };
  const summary: SubmissionSummary = { companyId, sent: records.length, accepted: 0, rejected: 0, failed: 0, waitSeconds: null, error: null };

  let response: ReturnType<typeof parseAeatResponse> | null = null;
  try {
    const envelope = buildRegFactuSoapEnvelope({ issuer, records: records as XmlRecord[] });
    const result = await transport.send(envelope);
    response = parseAeatResponse(result.body);
    if (response.fault || (result.httpStatus >= 400 && response.lines.length === 0)) {
      throw new Error(response.fault ?? `La AEAT respondió HTTP ${result.httpStatus}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al enviar a la AEAT.";
    summary.failed = records.length;
    summary.error = message;
    await client.transaction(async (tx) => {
      for (const record of records) {
        await tx
          .update(verifactuRecord)
          .set({ nextAttemptAt: new Date(now.getTime() + retryDelayMs(record.sendAttempts)), aeatErrorMessage: message.slice(0, 1000) })
          .where(eq(verifactuRecord.id, record.id));
      }
      await appendEvent(tx, { companyId, eventType: "SUBMISSION_ERROR", description: `Error al enviar ${records.length} registro(s) a la AEAT: ${message.slice(0, 300)}`, payload: { records: records.map((record) => record.sequence) } }, now);
    });
    return summary;
  }

  summary.waitSeconds = response.waitSeconds;
  await client.transaction(async (tx) => {
    for (const record of records) {
      const operation = record.recordType === "ANULACION" ? "Anulacion" : "Alta";
      const line = response!.lines.find((candidate) => candidate.invoiceNumber === record.invoiceNumber && (!candidate.operation || candidate.operation === operation));
      const outcome = outcomeForLine(line);
      if (outcome.status === "ACCEPTED" || outcome.status === "ACCEPTED_WITH_ERRORS") summary.accepted += 1;
      if (outcome.status === "REJECTED") summary.rejected += 1;
      await tx
        .update(verifactuRecord)
        .set({
          status: outcome.status,
          sentAt: now,
          nextAttemptAt: null,
          aeatCsv: response!.csv,
          aeatErrorCode: outcome.errorCode,
          aeatErrorMessage: outcome.errorMessage?.slice(0, 1000) ?? null,
        })
        .where(eq(verifactuRecord.id, record.id));
    }
    await appendEvent(tx, {
      companyId,
      eventType: "SUBMISSION",
      description: `Envío a la AEAT: ${summary.accepted} aceptado(s), ${summary.rejected} rechazado(s) de ${records.length}.`,
      payload: { csv: response!.csv, estadoEnvio: response!.submissionStatus, records: records.map((record) => record.sequence) },
    }, now);
  });
  return summary;
}

/** Procesa la cola: un lote por empresa con registros pendientes. Devuelve el resumen por empresa. */
export async function processPendingVerifactuRecords(options: { transport: VerifactuTransport; now?: Date; batchSize?: number; client?: AppDb; companyId?: string }) {
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
  for (const { companyId } of companies) {
    const leased = await leaseCompanyBatch(client, companyId, now, batchSize);
    if (leased.length === 0) continue;
    summaries.push(await submitLeasedBatch(client, options.transport, leased, now));
  }
  return summaries;
}
