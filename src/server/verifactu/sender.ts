import { and, asc, count, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { verifactuChainHead, verifactuRecord } from "@/db/schema";
import { db, type AppDb } from "@/lib/db";
import { appendEvent } from "@/server/verifactu/chain";
import { certificateValidity, getSystemCertificateInfo, loadCompanyCredentials } from "@/server/verifactu/certificates";
import { isVerifactuEnvironment, requireVerifactuEnvironment, type VerifactuEnvironment } from "@/server/verifactu/config";
import type { VerifactuCredentials, VerifactuTransport } from "@/server/verifactu/transport";
import { buildRegFactuSoapEnvelope, MAX_RECORDS_PER_SUBMISSION, parseAeatResponse, type AeatLineResult, type XmlRecord } from "@/server/verifactu/xml";

/**
 * Cola de envío VERI*FACTU (patrón del worker de OCR: arrendamiento + reintentos con espera creciente).
 *
 * 1. Se "arriendan" los registros pendientes de una empresa (FOR UPDATE SKIP LOCKED + nextAttemptAt
 *    en el futuro), en orden de encadenamiento. Solo los del entorno de este despliegue: un
 *    registro nacido en pruebas nunca se remite a producción, ni al revés.
 * 2. Se envían en un único mensaje RegFactuSistemaFacturacion (máx. 1.000 registros).
 * 3. Se actualiza el estado de cada registro con la respuesta. Solo se tocan columnas de estado:
 *    el trigger de inmutabilidad rechaza cualquier otro cambio.
 * Un error de red deja los registros PENDING_SEND con reintento diferido; un SOAP Fault provocado
 * por un registro concreto se aísla (ver `submitLeasedBatch`).
 *
 * Control de flujo (art. 16.2 de la Orden HAC/1177/2024): cada respuesta de la AEAT trae el tiempo
 * de espera hasta el siguiente envío. Se guarda en la cabeza de la cadena (por empresa y entorno)
 * junto con la hora del último envío, y lo respetan por igual el worker, «Enviar ahora» y el
 * aislamiento de fallos, aunque corran en procesos distintos.
 */

const LEASE_MS = 5 * 60_000;
/** Art. 16.4 de la Orden HAC/1177/2024: ante una incidencia hay que reintentar al menos una vez cada hora. */
const MAX_BACKOFF_MS = 60 * 60_000;
/** Código AEAT de registro duplicado: el registro ya consta en la AEAT (respuesta anterior perdida). */
const DUPLICATE_CODES = new Set(["3000"]);
/** Tiempo de espera inicial entre envíos mientras la AEAT no indique otro (art. 16.2 de la Orden). */
export const DEFAULT_WAIT_SECONDS = 60;

export function retryDelayMs(attempts: number) {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Milisegundos que faltan para poder hacer el siguiente envío de una empresa (0 = ya se puede).
 * Se puede enviar cuando han pasado «t» segundos desde el anterior envío o cuando hay acumulado
 * el máximo de registros de un envío, lo que ocurra primero.
 */
export function flowControlWaitMs(
  head: { lastSubmissionAt: Date | null; waitSeconds: number | null } | null | undefined,
  now: Date,
  pendingRecords = 0,
) {
  if (!head?.lastSubmissionAt) return 0;
  if (pendingRecords >= MAX_RECORDS_PER_SUBMISSION) return 0;
  const waitMs = Math.max(0, head.waitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;
  return Math.max(0, head.lastSubmissionAt.getTime() + waitMs - now.getTime());
}

export type LineOutcome = { status: "ACCEPTED" | "ACCEPTED_WITH_ERRORS" | "REJECTED" | "SENT"; errorCode: string | null; errorMessage: string | null };

/**
 * Resultado de un registro duplicado (3000): la AEAT ya lo tenía y dice en qué estado. No se da
 * por aceptado sin más: el estado nuestro debe ser el que consta allí.
 */
function outcomeForDuplicate(line: AeatLineResult, recordType: string): LineOutcome {
  const state = (line.duplicateStatus ?? "").trim().toLowerCase();
  const base = { errorCode: line.errorCode, errorMessage: line.errorMessage };
  if (state === "correcta") return { status: "ACCEPTED", ...base };
  if (state === "aceptadaconerrores") {
    return { status: "ACCEPTED_WITH_ERRORS", errorCode: line.errorCode, errorMessage: "El registro ya constaba en la AEAT, aceptado con errores: revísalo y subsánalo si procede." };
  }
  if (state === "anulada") {
    // Una anulación duplicada de algo ya anulado está hecha; un alta sobre una factura anulada no ha entrado.
    if (recordType === "ANULACION") return { status: "ACCEPTED", ...base };
    return { status: "REJECTED", errorCode: line.errorCode, errorMessage: "La AEAT tiene esta factura como anulada: el alta no se ha registrado." };
  }
  // Sin estado (respuestas antiguas o incompletas): el registro consta, pero no sabemos cómo.
  return { status: "ACCEPTED", errorCode: line.errorCode, errorMessage: line.errorMessage ?? "Registro duplicado: ya constaba en la AEAT." };
}

export function outcomeForLine(line: AeatLineResult | undefined, recordType: "ALTA" | "ANULACION" | string = "ALTA"): LineOutcome {
  if (!line) return { status: "SENT", errorCode: null, errorMessage: "La AEAT no devolvió resultado para este registro." };
  if (line.status === "Correcto") return { status: "ACCEPTED", errorCode: null, errorMessage: null };
  if (line.status === "AceptadoConErrores") return { status: "ACCEPTED_WITH_ERRORS", errorCode: line.errorCode, errorMessage: line.errorMessage };
  if (line.errorCode && DUPLICATE_CODES.has(line.errorCode)) return outcomeForDuplicate(line, recordType);
  return { status: "REJECTED", errorCode: line.errorCode, errorMessage: line.errorMessage };
}

type LeasedRecord = typeof verifactuRecord.$inferSelect;

/** Registros que este despliegue puede remitir ya: pendientes, VERI*FACTU, de su entorno y con el reintento vencido. */
function dueRecords(environment: VerifactuEnvironment, now: Date, companyId?: string) {
  return and(
    companyId ? eq(verifactuRecord.companyId, companyId) : undefined,
    eq(verifactuRecord.status, "PENDING_SEND"),
    eq(verifactuRecord.mode, "VERIFACTU"),
    eq(verifactuRecord.environment, environment),
    or(isNull(verifactuRecord.nextAttemptAt), lte(verifactuRecord.nextAttemptAt, now)),
  );
}

async function leaseCompanyBatch(client: AppDb, companyId: string, environment: VerifactuEnvironment, now: Date, limit: number): Promise<LeasedRecord[]> {
  return client.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(verifactuRecord)
      .where(dueRecords(environment, now, companyId))
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

export type SubmissionSummary = {
  companyId: string;
  sent: number;
  accepted: number;
  rejected: number;
  failed: number;
  /** Tiempo de espera indicado por la AEAT en este envío. */
  waitSeconds: number | null;
  /** Segundos que faltan para poder enviar: no se ha enviado nada por el control de flujo. */
  throttledSeconds?: number | null;
  error: string | null;
};

type AeatResponse = ReturnType<typeof parseAeatResponse>;
type SendAttempt = { ok: true; response: AeatResponse } | { ok: false; message: string; fault: boolean };

/** Un registro se considera remitido con incidencia si ya falló un envío o lleva más de una hora generado. */
const INCIDENT_AGE_MS = 60 * 60_000;
/** Envíos extra, como mucho, para aislar el registro que hace fallar un lote entero. */
const MAX_ISOLATION_SENDS = 24;

export function isIncidentBatch(records: Array<{ sendAttempts: number; generatedAt: Date }>, now: Date) {
  return records.some((record) => record.sendAttempts > 1 || now.getTime() - record.generatedAt.getTime() > INCIDENT_AGE_MS);
}

function environmentOf(record: { environment: string }): VerifactuEnvironment {
  if (!isVerifactuEnvironment(record.environment)) throw new Error(`Registro VERI*FACTU con un entorno desconocido: «${record.environment}».`);
  return record.environment;
}

async function sendOnce(transport: VerifactuTransport, records: LeasedRecord[], credentials: VerifactuCredentials | null, now: Date): Promise<SendAttempt> {
  try {
    const envelope = buildRegFactuSoapEnvelope({
      issuer: { name: records[0].issuerName, taxId: records[0].issuerTaxId },
      records: records as XmlRecord[],
      incident: isIncidentBatch(records, now),
    });
    // El punto de acceso sale del entorno DE LOS REGISTROS que viajan, no de una variable global.
    const result = await transport.send(envelope, credentials, { environment: environmentOf(records[0]) });
    const response = parseAeatResponse(result.body);
    if (response.fault) return { ok: false, message: response.fault, fault: true };
    if (result.httpStatus >= 400 && response.lines.length === 0) return { ok: false, message: `La AEAT respondió HTTP ${result.httpStatus}.`, fault: false };
    return { ok: true, response };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Error desconocido al enviar a la AEAT.", fault: false };
  }
}

export type SubmitOptions = {
  /**
   * Espera entre envíos. Solo quien puede esperar (el worker) aísla el registro que hace fallar un
   * lote: cada envío de aislamiento respeta el tiempo de espera de la AEAT. Sin ella («Enviar
   * ahora») un fallo del lote lo deja entero pendiente y el worker lo aislará.
   */
  pause?: (milliseconds: number) => Promise<void>;
  /** Tiempo de espera vigente antes de este envío (el último que indicó la AEAT). */
  waitSeconds?: number | null;
};

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
  options: SubmitOptions = {},
): Promise<SubmissionSummary> {
  const companyId = records[0].companyId;
  const environment = environmentOf(records[0]);
  if (records.some((record) => record.companyId !== companyId || record.environment !== environment)) {
    throw new Error("Un envío VERI*FACTU solo puede llevar registros de una empresa y de un único entorno.");
  }
  const summary: SubmissionSummary = { companyId, sent: records.length, accepted: 0, rejected: 0, failed: 0, waitSeconds: null, error: null };
  const delivered: Array<{ records: LeasedRecord[]; response: AeatResponse }> = [];
  const failed: Array<{ records: LeasedRecord[]; message: string; fault: boolean }> = [];
  let isolationSends = 0;
  let elapsedMs = 0;
  let currentWaitSeconds = options.waitSeconds ?? DEFAULT_WAIT_SECONDS;
  const clock = () => new Date(now.getTime() + elapsedMs);

  /** Espera el tiempo que pide la AEAT antes de otro envío, sin soltar el arrendamiento del lote. */
  const waitForNextSend = async (pause: NonNullable<SubmitOptions["pause"]>) => {
    const waitMs = Math.max(0, currentWaitSeconds) * 1000;
    if (waitMs > 0) {
      await client
        .update(verifactuRecord)
        .set({ nextAttemptAt: new Date(now.getTime() + elapsedMs + waitMs + LEASE_MS) })
        .where(inArray(verifactuRecord.id, records.map((record) => record.id)));
      await pause(waitMs);
      elapsedMs += waitMs;
    }
  };

  const attempt = async (group: LeasedRecord[]): Promise<void> => {
    const result = await sendOnce(transport, group, credentials, clock());
    if (result.ok) {
      if (result.response.waitSeconds !== null) currentWaitSeconds = result.response.waitSeconds;
      delivered.push({ records: group, response: result.response });
      return;
    }
    if (result.fault && group.length > 1 && options.pause && isolationSends + 2 <= MAX_ISOLATION_SENDS) {
      isolationSends += 2;
      const middle = Math.ceil(group.length / 2);
      await waitForNextSend(options.pause);
      await attempt(group.slice(0, middle));
      await waitForNextSend(options.pause);
      await attempt(group.slice(middle));
      return;
    }
    failed.push({ records: group, message: result.message, fault: result.fault });
  };
  await attempt(records);
  const finishedAt = clock();

  await client.transaction(async (tx) => {
    for (const { records: group, response } of delivered) {
      if (response.waitSeconds !== null) summary.waitSeconds = Math.max(summary.waitSeconds ?? 0, response.waitSeconds);
      let accepted = 0;
      let rejected = 0;
      for (const record of group) {
        const operation = record.recordType === "ANULACION" ? "Anulacion" : "Alta";
        const line = response.lines.find((candidate) => candidate.invoiceNumber === record.invoiceNumber && (!candidate.operation || candidate.operation === operation));
        const outcome = outcomeForLine(line, record.recordType);
        if (outcome.status === "SENT") {
          // Sin línea de respuesta no se sabe si consta: se reintenta (si ya constaba, la AEAT lo dirá como duplicado).
          summary.failed += 1;
          await tx
            .update(verifactuRecord)
            .set({ nextAttemptAt: new Date(finishedAt.getTime() + retryDelayMs(record.sendAttempts)), aeatErrorMessage: outcome.errorMessage })
            .where(eq(verifactuRecord.id, record.id));
          continue;
        }
        if (outcome.status === "REJECTED") rejected += 1;
        else accepted += 1;
        await tx
          .update(verifactuRecord)
          .set({
            status: outcome.status,
            sentAt: finishedAt,
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
        environment,
        eventType: "SUBMISSION",
        description: `Envío a la AEAT: ${accepted} aceptado(s), ${rejected} rechazado(s) de ${group.length}.`,
        payload: { csv: response.csv, estadoEnvio: response.submissionStatus, records: group.map((record) => record.sequence) },
      }, finishedAt);
    }

    for (const { records: group, message, fault } of failed) {
      // Aislado: solo este registro falla mientras otros del mismo lote se aceptan → es el culpable.
      const isolated = fault && group.length === 1 && delivered.length > 0;
      if (isolated) {
        summary.rejected += 1;
        await tx
          .update(verifactuRecord)
          .set({ status: "REJECTED", sentAt: finishedAt, nextAttemptAt: null, aeatErrorCode: "SOAP", aeatErrorMessage: message.slice(0, 1000) })
          .where(eq(verifactuRecord.id, group[0].id));
      } else {
        summary.failed += group.length;
        for (const record of group) {
          await tx
            .update(verifactuRecord)
            .set({ nextAttemptAt: new Date(finishedAt.getTime() + retryDelayMs(record.sendAttempts)), aeatErrorMessage: message.slice(0, 1000) })
            .where(eq(verifactuRecord.id, record.id));
        }
      }
      summary.error ??= message;
      await appendEvent(tx, {
        companyId,
        environment,
        eventType: "SUBMISSION_ERROR",
        description: isolated
          ? `La AEAT no admite el registro n.º ${group[0].sequence}: ${message.slice(0, 300)}`
          : `Error al enviar ${group.length} registro(s) a la AEAT: ${message.slice(0, 300)}`,
        payload: { records: group.map((record) => record.sequence) },
      }, finishedAt);
    }

    // Control de flujo: hora de este envío y espera que pide la AEAT, para el siguiente (de cualquier proceso).
    await tx
      .update(verifactuChainHead)
      .set({ lastSubmissionAt: finishedAt, ...(summary.waitSeconds !== null ? { waitSeconds: summary.waitSeconds } : {}) })
      .where(and(eq(verifactuChainHead.companyId, companyId), eq(verifactuChainHead.environment, environment)));
  });
  return summary;
}

/**
 * Procesa la cola: un lote por empresa con registros pendientes del entorno de este despliegue.
 * Devuelve el resumen por empresa (también de las que no se han podido enviar todavía por el
 * control de flujo o por tener el certificado caducado).
 */
export async function processPendingVerifactuRecords(options: {
  transport: VerifactuTransport;
  now?: Date;
  batchSize?: number;
  client?: AppDb;
  companyId?: string;
  /** Certificado de cada empresa (por defecto, el que haya subido). */
  credentialsFor?: (companyId: string) => Promise<VerifactuCredentials | null>;
  /** Ver `SubmitOptions.pause`: el worker la pasa para poder aislar fallos respetando la espera. */
  pause?: SubmitOptions["pause"];
}) {
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const batchSize = Math.min(options.batchSize ?? MAX_RECORDS_PER_SUBMISSION, MAX_RECORDS_PER_SUBMISSION);
  const environment = options.transport.environment ?? requireVerifactuEnvironment();
  const companies = await client
    .selectDistinct({ companyId: verifactuRecord.companyId })
    .from(verifactuRecord)
    .where(dueRecords(environment, now, options.companyId));
  const summaries: SubmissionSummary[] = [];
  const credentialsFor = options.credentialsFor ?? ((companyId: string) => loadCompanyCredentials(client, companyId));
  const skipped = (companyId: string, extra: Partial<SubmissionSummary>): SubmissionSummary =>
    ({ companyId, sent: 0, accepted: 0, rejected: 0, failed: 0, waitSeconds: null, error: null, ...extra });
  for (const { companyId } of companies) {
    const credentials = await credentialsFor(companyId);
    // Sin certificado propio ni del sistema no hay con qué remitir: los registros siguen pendientes.
    if (!credentials && options.transport.requiresCredentials) continue;
    if (credentials && certificateValidity(credentials.validTo, now).expired) {
      summaries.push(skipped(companyId, { error: "El certificado electrónico de la empresa está caducado: los registros siguen pendientes hasta que se suba uno vigente." }));
      continue;
    }
    // Mismo control para el certificado del sistema (solo en el transporte real: los de prueba no lo usan).
    if (!credentials && options.transport.kind === "aeat") {
      const system = await getSystemCertificateInfo();
      if (system?.validTo && certificateValidity(system.validTo, now).expired) {
        summaries.push(skipped(companyId, { error: "El certificado electrónico del sistema está caducado: los registros siguen pendientes hasta que se renueve o la empresa suba el suyo." }));
        continue;
      }
    }
    const [head] = await client
      .select({ lastSubmissionAt: verifactuChainHead.lastSubmissionAt, waitSeconds: verifactuChainHead.waitSeconds })
      .from(verifactuChainHead)
      .where(and(eq(verifactuChainHead.companyId, companyId), eq(verifactuChainHead.environment, environment)))
      .limit(1);
    if (flowControlWaitMs(head, now) > 0) {
      const [due] = await client.select({ total: count() }).from(verifactuRecord).where(dueRecords(environment, now, companyId));
      const waitMs = flowControlWaitMs(head, now, Number(due?.total ?? 0));
      if (waitMs > 0) {
        summaries.push(skipped(companyId, { throttledSeconds: Math.ceil(waitMs / 1000) }));
        continue;
      }
    }
    const leased = await leaseCompanyBatch(client, companyId, environment, now, batchSize);
    if (leased.length === 0) continue;
    summaries.push(await submitLeasedBatch(client, options.transport, leased, now, credentials, { pause: options.pause, waitSeconds: head?.waitSeconds ?? null }));
  }
  return summaries;
}
