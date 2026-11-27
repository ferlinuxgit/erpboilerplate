/**
 * Lo que necesita la pantalla Fiscalidad › SII: estado, pendientes con su plazo, rechazados con su
 * error, reenvío y exportación de lo suministrado.
 */
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { siiRecord, siiSettings } from "@/db/schema";
import { db } from "@/lib/db";
import { fiscalCivilDate, localMidnightInstant } from "@/lib/fiscal-spain";
import { HttpError } from "@/lib/http";
import { getSiiTransportConfig, isSiiEnvironment, readSiiEnvironment, requireSiiEnvironment, siiEnvironmentLabels } from "@/server/sii/config";
import { civilKey, formatCivil, parseCivilKey, siiDeadlineStatus, type SiiDeadlineStatus } from "@/server/sii/deadlines";
import { detectSiiRecords, ensureSiiSettings, isRegisteredInSii, loadSiiCompanyProfile, siiEligibility, type OutboxHistoryEntry } from "@/server/sii/outbox";
import { SII_ERROR_DUPLICATE, SII_FAULT_ERROR, SII_TRANSPORT_ERROR } from "@/server/sii/sender";
import type { SiiBook, SiiOperation, SiiStatus } from "@/server/sii/types";
import { getCompanyCertificateInfo } from "@/server/verifactu/certificates";

export const siiStatusLabels: Record<string, string> = {
  PENDING: "Pendiente de envío",
  SENT: "Enviado, sin confirmar",
  ACCEPTED: "Aceptado",
  ACCEPTED_WITH_ERRORS: "Aceptado con errores",
  REJECTED: "Rechazado",
};

export const siiStatusTone: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "warning",
  SENT: "info",
  ACCEPTED: "success",
  ACCEPTED_WITH_ERRORS: "warning",
  REJECTED: "danger",
};

export const siiBookLabels: Record<string, string> = { ISSUED: "Expedida", RECEIVED: "Recibida" };
export const siiOperationLabels: Record<string, string> = { A0: "Alta", A1: "Modificación", BAJA: "Baja" };

export type SiiRecordView = {
  id: string;
  book: SiiBook;
  sourceId: string;
  operation: SiiOperation;
  status: SiiStatus;
  fiscalYear: string;
  period: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceTypeCode: string | null;
  counterpartyName: string | null;
  totalAmount: string | null;
  dueDate: string | null;
  /** «15/03/2027», o null si el registro no tiene plazo propio. */
  dueLabel: string | null;
  deadline: SiiDeadlineStatus | null;
  blockedReason: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  aeatCsv: string | null;
  aeatErrorCode: string | null;
  aeatErrorMessage: string | null;
  /** El último envío falló sin respuesta por registro (conexión o rechazo del envío completo). */
  sendFailed: boolean;
  createdAt: Date;
};

const recordView = {
  id: siiRecord.id,
  book: siiRecord.book,
  sourceId: siiRecord.sourceId,
  operation: siiRecord.operation,
  status: siiRecord.status,
  fiscalYear: siiRecord.fiscalYear,
  period: siiRecord.period,
  invoiceNumber: siiRecord.invoiceNumber,
  invoiceDate: siiRecord.invoiceDate,
  invoiceTypeCode: siiRecord.invoiceTypeCode,
  counterpartyName: siiRecord.counterpartyName,
  totalAmount: siiRecord.totalAmount,
  dueDate: siiRecord.dueDate,
  blockedReason: siiRecord.blockedReason,
  attempts: siiRecord.attempts,
  nextAttemptAt: siiRecord.nextAttemptAt,
  sentAt: siiRecord.sentAt,
  aeatCsv: siiRecord.aeatCsv,
  aeatErrorCode: siiRecord.aeatErrorCode,
  aeatErrorMessage: siiRecord.aeatErrorMessage,
  createdAt: siiRecord.createdAt,
};

type RawView = Pick<typeof siiRecord.$inferSelect, keyof typeof recordView>;

/** Un registro está fuera de plazo mientras su alta no esté aceptada y haya pasado el último día. */
function toView(row: RawView, today: { year: number; month: number; day: number }): SiiRecordView {
  const due = parseCivilKey(row.dueDate);
  const open = row.status === "PENDING" || row.status === "REJECTED" || row.status === "SENT";
  return {
    ...row,
    book: row.book as SiiBook,
    operation: row.operation as SiiOperation,
    status: row.status as SiiStatus,
    dueLabel: due ? formatCivil(due) : null,
    deadline: due && open ? siiDeadlineStatus(due, today) : null,
    sendFailed: row.status === "PENDING" && (row.aeatErrorCode === SII_TRANSPORT_ERROR || row.aeatErrorCode === SII_FAULT_ERROR),
  };
}

export async function getSiiOverview(companyId: string, now = new Date()) {
  const profile = await loadSiiCompanyProfile(db, companyId);
  if (!profile) throw new HttpError(404, "Empresa no encontrada.");
  const eligibility = siiEligibility(profile);
  const environmentConfig = readSiiEnvironment();
  const transportConfig = getSiiTransportConfig();
  const [settings] = await db.select().from(siiSettings).where(eq(siiSettings.companyId, companyId)).limit(1);
  const certificate = await getCompanyCertificateInfo(db, companyId);
  const today = fiscalCivilDate(now, profile.timezone);
  const environment = environmentConfig.environment;

  // Registro vigente de cada factura: su última comunicación en este entorno.
  const current = environment
    ? (await db
        .selectDistinctOn([siiRecord.book, siiRecord.sourceId], recordView)
        .from(siiRecord)
        .where(and(eq(siiRecord.companyId, companyId), eq(siiRecord.environment, environment)))
        .orderBy(siiRecord.book, siiRecord.sourceId, desc(siiRecord.createdAt), desc(siiRecord.id))
      ).map((row) => toView(row, today))
    : [];
  const [otherEnvironment] = environment
    ? await db.select({ count: sql<number>`count(*)::int` }).from(siiRecord).where(and(eq(siiRecord.companyId, companyId), ne(siiRecord.environment, environment)))
    : [{ count: 0 }];

  const byNewest = (left: SiiRecordView, right: SiiRecordView) => right.createdAt.getTime() - left.createdAt.getTime();
  const byDue = (left: SiiRecordView, right: SiiRecordView) => (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999") || byNewest(left, right);
  const counts: Record<string, number> = {};
  for (const record of current) counts[record.status] = (counts[record.status] ?? 0) + 1;
  const pending = current.filter((record) => record.status === "PENDING" || record.status === "SENT").sort(byDue);
  const rejected = current.filter((record) => record.status === "REJECTED" || record.status === "ACCEPTED_WITH_ERRORS").sort(byNewest);
  const accepted = current.filter((record) => record.status === "ACCEPTED").sort((left, right) => (right.sentAt?.getTime() ?? 0) - (left.sentAt?.getTime() ?? 0));
  const overdue = current.filter((record) => record.deadline === "overdue");

  return {
    companyName: profile.name,
    eligibility,
    environment,
    environmentProblem: environmentConfig.problem,
    transport: { enabled: transportConfig.kind === "aeat", reason: transportConfig.kind === "disabled" ? transportConfig.reason : null, systemCertificate: transportConfig.kind === "aeat" && Boolean(transportConfig.certPath) },
    certificate: certificate ? { subject: certificate.subject, validTo: certificate.validTo, expired: Boolean(certificate.validTo && certificate.validTo.getTime() < now.getTime()) } : null,
    since: settings?.since ?? null,
    sinceKey: settings?.since ? civilKey(fiscalCivilDate(settings.since, profile.timezone)) : null,
    lastDetectionAt: settings?.lastDetectionAt ?? null,
    counts,
    total: current.length,
    pending,
    blocked: pending.filter((record) => record.blockedReason),
    rejected,
    overdue,
    accepted: accepted.slice(0, 50),
    acceptedTotal: accepted.length,
    otherEnvironmentCount: otherEnvironment?.count ?? 0,
  };
}

export type SiiOverview = Awaited<ReturnType<typeof getSiiOverview>>;

async function requireSupported(companyId: string) {
  const profile = await loadSiiCompanyProfile(db, companyId);
  if (!profile) throw new HttpError(404, "Empresa no encontrada.");
  const eligibility = siiEligibility(profile);
  if (!eligibility.supported) throw new HttpError(409, eligibility.reason ?? "El SII no está disponible para esta empresa.");
  return profile;
}

/** «Revisar ahora»: recorre las facturas y actualiza la bandeja de salida. */
export async function refreshSiiOutbox(companyId: string) {
  await requireSupported(companyId);
  requireSiiEnvironment();
  return detectSiiRecords(companyId);
}

/** Cambia la fecha desde la que se suministran las facturas (AAAA-MM-DD, en la zona horaria de la empresa). */
export async function updateSiiSince(companyId: string, sinceKey: string) {
  const profile = await requireSupported(companyId);
  const date = parseCivilKey(sinceKey);
  if (!date) throw new HttpError(400, "Indica una fecha válida.");
  await ensureSiiSettings(db, profile);
  const since = localMidnightInstant(date.year, date.month - 1, date.day, profile.timezone);
  await db.update(siiSettings).set({ since, updatedAt: new Date() }).where(eq(siiSettings.companyId, companyId));
  return { since };
}

/**
 * «Reenviar»: vuelve a poner en la bandeja una comunicación rechazada, aceptada con errores o sin
 * confirmar, con el contenido actual de la factura. Si la factura ya consta en el SII (o la AEAT
 * dijo que estaba duplicada), sale como modificación (A1); si no, como alta (A0).
 * Un registro pendiente con el reintento aplazado simplemente se adelanta.
 */
export async function resendSiiRecord(companyId: string, recordId: string) {
  await requireSupported(companyId);
  const environment = requireSiiEnvironment();
  const [record] = await db.select().from(siiRecord).where(and(eq(siiRecord.id, recordId), eq(siiRecord.companyId, companyId))).limit(1);
  if (!record) throw new HttpError(404, "Registro no encontrado.");
  if (record.environment !== environment) {
    const label = isSiiEnvironment(record.environment) ? siiEnvironmentLabels[record.environment] : record.environment;
    throw new HttpError(409, `Este registro es del entorno de ${label} de la AEAT y este servidor trabaja en ${siiEnvironmentLabels[environment]}: no se puede reenviar desde aquí.`);
  }
  // Primero se recoge cualquier cambio de la factura: si lo hay, la propia revisión ya crea la comunicación.
  await detectSiiRecords(companyId);
  const history = await db
    .select({ id: siiRecord.id, operation: siiRecord.operation, status: siiRecord.status, contentHash: siiRecord.contentHash })
    .from(siiRecord)
    .where(and(eq(siiRecord.companyId, companyId), eq(siiRecord.environment, environment), eq(siiRecord.book, record.book), eq(siiRecord.sourceId, record.sourceId)))
    .orderBy(asc(siiRecord.createdAt), asc(siiRecord.id));
  const latest = history[history.length - 1];
  if (!latest) throw new HttpError(404, "Registro no encontrado.");
  if (latest.status === "PENDING") {
    await db.update(siiRecord).set({ nextAttemptAt: null, lastAttemptAt: null, updatedAt: new Date() }).where(and(eq(siiRecord.id, latest.id), eq(siiRecord.status, "PENDING")));
    return { recordId: latest.id, operation: latest.operation, requeued: true };
  }
  if (latest.id !== record.id) throw new HttpError(409, "Esta factura tiene una comunicación más reciente: actualiza la página.");
  if (latest.status === "ACCEPTED") throw new HttpError(409, "Este registro ya está aceptado por la AEAT: no hay nada que reenviar.");

  const registered = isRegisteredInSii(history as OutboxHistoryEntry[]);
  const operation: SiiOperation = record.operation === "BAJA" ? "BAJA" : registered || record.aeatErrorCode === SII_ERROR_DUPLICATE ? "A1" : "A0";
  const [created] = await db
    .insert(siiRecord)
    .values({
      companyId,
      book: record.book,
      sourceId: record.sourceId,
      operation,
      environment,
      status: "PENDING",
      fiscalYear: record.fiscalYear,
      period: record.period,
      invoiceNumber: record.invoiceNumber,
      invoiceDate: record.invoiceDate,
      invoiceTypeCode: record.invoiceTypeCode,
      counterpartyName: record.counterpartyName,
      totalAmount: record.totalAmount,
      payload: record.payload,
      contentHash: record.contentHash,
      dueDate: operation === "A0" ? record.dueDate : null,
      blockedReason: record.blockedReason,
    })
    .onConflictDoNothing()
    .returning({ id: siiRecord.id });
  if (!created) throw new HttpError(409, "Esta factura ya tiene una comunicación pendiente de envío.");
  return { recordId: created.id, operation, requeued: false };
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Exportación (CSV para Excel en español) de todo lo comunicado al SII en el entorno de este despliegue. */
export async function exportSiiRecords(companyId: string) {
  const environment = requireSiiEnvironment();
  const records = await db
    .select()
    .from(siiRecord)
    .where(and(eq(siiRecord.companyId, companyId), eq(siiRecord.environment, environment)))
    .orderBy(asc(siiRecord.createdAt), asc(siiRecord.id));
  const header = ["Libro", "Comunicación", "Estado", "Ejercicio", "Periodo", "N.º factura", "Fecha expedición", "Tipo factura", "Contraparte", "Importe total", "Vence el", "Enviado el", "CSV AEAT", "Código error", "Error", "Entorno"];
  const rows = records.map((record) => [
    siiBookLabels[record.book] ?? record.book,
    siiOperationLabels[record.operation] ?? record.operation,
    siiStatusLabels[record.status] ?? record.status,
    record.fiscalYear,
    record.period,
    record.invoiceNumber,
    record.invoiceDate,
    record.invoiceTypeCode,
    record.counterpartyName,
    record.totalAmount ? record.totalAmount.replace(".", ",") : "",
    record.dueDate ? formatCivil(parseCivilKey(record.dueDate)!) : "",
    record.sentAt ? record.sentAt.toISOString() : "",
    record.aeatCsv,
    record.aeatErrorCode,
    record.aeatErrorMessage ?? record.blockedReason,
    siiEnvironmentLabels[environment],
  ].map(csvCell).join(";"));
  return {
    filename: `sii-registros-${environment === "test" ? "pruebas-" : ""}${new Date().toISOString().slice(0, 10)}.csv`,
    contentType: "text/csv; charset=utf-8",
    content: `﻿${[header.join(";"), ...rows].join("\r\n")}\r\n`,
  };
}
