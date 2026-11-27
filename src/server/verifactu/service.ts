import { and, asc, count, desc, eq, lt, min, ne, sql } from "drizzle-orm";

import { verifactuEvent, verifactuRecord } from "@/db/schema";
import { db } from "@/lib/db";
import { certificateValidity, getCompanyCertificateInfo, getVerifactuReadiness, type CompanyCertificateInfo, type VerifactuReadiness } from "@/server/verifactu/certificates";
import { appendEvent } from "@/server/verifactu/chain";
import {
  getVerifactuTransportConfig,
  isVerifactuEnvironment,
  readVerifactuEnvironment,
  requireVerifactuEnvironment,
  TEST_ENVIRONMENT_LABEL,
  verifactuEnvironmentLabels,
  type VerifactuEnvironment,
} from "@/server/verifactu/config";
import { buildVerifactuQrUrl, QR_CAPTION, renderQrPngDataUrl, renderQrSvg, verifactuLegends } from "@/server/verifactu/qr";
import { getVerifactuSettings, type VerifactuModeSetting } from "@/server/verifactu/settings";
import { subsanacionBlockFor } from "@/server/verifactu/validation";
import { buildRecordsExportXml, type XmlRecord } from "@/server/verifactu/xml";

export const verifactuStatusLabels: Record<string, string> = {
  PENDING_SEND: "Pendiente de envío",
  SENT: "Enviado (sin respuesta)",
  ACCEPTED: "Aceptado por la AEAT",
  ACCEPTED_WITH_ERRORS: "Aceptado con errores",
  REJECTED: "Rechazado",
  NOT_REQUIRED: "Conservado (no se envía)",
};

export const verifactuStatusTone: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  PENDING_SEND: "warning",
  SENT: "info",
  ACCEPTED: "success",
  ACCEPTED_WITH_ERRORS: "warning",
  REJECTED: "danger",
  NOT_REQUIRED: "neutral",
};

/** Un registro pendiente más de este tiempo es una incidencia que hay que enseñar (art. 16.4 de la Orden). */
export const PENDING_OVERDUE_MS = 60 * 60_000;

export type VerifactuHealthIssueCode =
  | "ENVIRONMENT_MISSING"
  | "TEST_ENVIRONMENT"
  | "LEGACY_MODE"
  | "TRANSPORT_OFF"
  | "CERTIFICATE_MISSING"
  | "CERTIFICATE_EXPIRED"
  | "CERTIFICATE_EXPIRING"
  | "PENDING_OVERDUE"
  | "REJECTED"
  | "OTHER_ENVIRONMENT";

export type VerifactuHealthIssue = { code: VerifactuHealthIssueCode; tone: "danger" | "warning" | "info"; title: string; message: string };

export type VerifactuHealth = {
  /** La empresa genera registros (modo distinto de «sin activar»). */
  active: boolean;
  /** Entorno de la AEAT de este despliegue; null si no está declarado. */
  environment: VerifactuEnvironment | null;
  /** Sin incidencias graves (los avisos informativos, como el entorno de pruebas, no cuentan). */
  ok: boolean;
  issues: VerifactuHealthIssue[];
  /** Registros sin remitir desde hace más de una hora y fecha del más antiguo. */
  overduePending: number;
  oldestPendingAt: Date | null;
  /** Registros rechazados por la AEAT que siguen sin corregir. */
  rejected: number;
  /** Registros pendientes nacidos en otro entorno: este despliegue no los enviará. */
  otherEnvironmentPending: number;
};

export type VerifactuHealthInput = {
  mode: VerifactuModeSetting;
  environment: VerifactuEnvironment | null;
  environmentProblem: string | null;
  readiness: VerifactuReadiness;
  certificate: Pick<CompanyCertificateInfo, "validTo"> | null;
  overduePending: number;
  oldestPendingAt: Date | null;
  rejected: number;
  otherEnvironmentPending: number;
  now: Date;
};

const plural = (total: number, one: string, many: string) => `${total.toLocaleString("es-ES")} ${total === 1 ? one : many}`;
const longDateTime = (date: Date) => new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(date);
const longDate = (date: Date) => new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(date);

/** Incidencias de VERI*FACTU a partir de los datos ya leídos (código puro, para poder probarlo). */
export function buildVerifactuHealth(input: VerifactuHealthInput): VerifactuHealth {
  const issues: VerifactuHealthIssue[] = [];
  const active = input.mode !== "pending";
  const sending = input.mode === "verifactu";

  if (!input.environment) {
    issues.push({
      code: "ENVIRONMENT_MISSING",
      // Con VERI*FACTU activo bloquea la facturación; sin activar, solo impide activarlo.
      tone: active ? "danger" : "warning",
      title: "Falta indicar el entorno de la AEAT",
      message: `${input.environmentProblem ?? "No se ha declarado el entorno de VERI*FACTU."} Mientras tanto no se pueden emitir facturas con registro ni enviar nada a la AEAT. Lo configura el administrador del sistema.`,
    });
  } else if (input.environment === "test" && active) {
    issues.push({
      code: "TEST_ENVIRONMENT",
      tone: "warning",
      title: TEST_ENVIRONMENT_LABEL,
      message: "Este servidor trabaja contra el entorno de pruebas de la AEAT: los registros no llegan a Hacienda y las facturas que se emitan aquí no tienen validez fiscal.",
    });
  }

  if (input.mode === "non_verifactu") {
    issues.push({
      code: "LEGACY_MODE",
      tone: "danger",
      title: "La modalidad NO VERI*FACTU ya no está disponible",
      message: "Con ella no se generan registros conformes, así que la emisión y la anulación de facturas están bloqueadas. Activa VERI*FACTU en Configuración › Fiscalidad.",
    });
  }

  if (sending && input.environment) {
    const validity = certificateValidity(input.certificate?.validTo, input.now);
    if (validity.expired && input.certificate?.validTo) {
      issues.push({
        code: "CERTIFICATE_EXPIRED",
        tone: "danger",
        title: "El certificado electrónico está caducado",
        message: `Caducó el ${longDate(input.certificate.validTo)} y la AEAT ya no admite tus envíos. Las facturas se siguen registrando y quedan pendientes: sube un certificado vigente en Configuración › Fiscalidad.`,
      });
    } else if (!input.readiness.operational && input.readiness.cause === "certificate-missing") {
      issues.push({
        code: "CERTIFICATE_MISSING",
        tone: "danger",
        title: "Falta el certificado electrónico",
        message: "Sin certificado no se puede enviar nada a la AEAT: las facturas se registran y quedan pendientes. Súbelo en Configuración › Fiscalidad.",
      });
    } else if (!input.readiness.operational) {
      issues.push({
        code: "TRANSPORT_OFF",
        tone: "danger",
        title: "Tus facturas no se están enviando a la AEAT",
        message: `${input.readiness.reason ?? "El envío no está operativo."} Las facturas se siguen registrando con su huella y quedan pendientes de envío, sin la leyenda «VERI*FACTU».`,
      });
    } else if (validity.expiringSoon && input.certificate?.validTo) {
      issues.push({
        code: "CERTIFICATE_EXPIRING",
        tone: "warning",
        title: validity.daysLeft !== null && validity.daysLeft <= 0 ? "El certificado electrónico caduca hoy" : `El certificado electrónico caduca en ${plural(Math.max(1, validity.daysLeft ?? 1), "día", "días")}`,
        message: `Es válido hasta el ${longDate(input.certificate.validTo)}. Renuévalo y súbelo antes en Configuración › Fiscalidad para no interrumpir los envíos.`,
      });
    }
  }

  if (input.overduePending > 0) {
    issues.push({
      code: "PENDING_OVERDUE",
      tone: "danger",
      title: `${plural(input.overduePending, "registro sin remitir", "registros sin remitir")}${input.oldestPendingAt ? ` desde el ${longDateTime(input.oldestPendingAt)}` : ""}`,
      message: "Llevan más de una hora esperando el envío a la AEAT. Se remitirán solos, en orden, en cuanto se resuelva la causa; si no hay ningún otro aviso en esta pantalla, avisa a soporte.",
    });
  }

  if (input.rejected > 0) {
    issues.push({
      code: "REJECTED",
      tone: "danger",
      title: `${plural(input.rejected, "registro rechazado", "registros rechazados")} por la AEAT`,
      message: "Esas facturas no constan en Hacienda. Revisa el motivo en la tabla: si es un dato de tu empresa, corrígelo y pulsa «Subsanar»; si lo erróneo es el cliente (NIF o nombre) o los importes, emite una factura rectificativa.",
    });
  }

  if (input.otherEnvironmentPending > 0 && input.environment) {
    const other = input.environment === "production" ? "test" : "production";
    issues.push({
      code: "OTHER_ENVIRONMENT",
      tone: "warning",
      title: `${plural(input.otherEnvironmentPending, "registro pendiente", "registros pendientes")} del entorno de ${verifactuEnvironmentLabels[other]}`,
      message: `Se generaron cuando este sistema trabajaba en ${verifactuEnvironmentLabels[other]} y este servidor está en ${verifactuEnvironmentLabels[input.environment]}: no se enviarán desde aquí, para no mezclar entornos.`,
    });
  }

  return {
    active,
    environment: input.environment,
    ok: !issues.some((issue) => issue.tone === "danger"),
    issues,
    overduePending: input.overduePending,
    oldestPendingAt: input.oldestPendingAt,
    rejected: input.rejected,
    otherEnvironmentPending: input.otherEnvironmentPending,
  };
}

/**
 * Estado de salud de VERI*FACTU de una empresa: entorno, certificado, registros sin remitir desde
 * hace más de una hora y rechazos sin corregir. Pensado para pintarlo en cualquier parte de la
 * aplicación (cada incidencia trae tono, título y mensaje listos para un aviso).
 */
export async function getVerifactuHealth(companyId: string, now = new Date()): Promise<VerifactuHealth> {
  const environmentConfig = readVerifactuEnvironment();
  const environment = environmentConfig.environment;
  const sendable = and(eq(verifactuRecord.companyId, companyId), eq(verifactuRecord.status, "PENDING_SEND"), eq(verifactuRecord.mode, "VERIFACTU"));
  const [settings, readiness, certificate, [overdue], [rejected], [foreign]] = await Promise.all([
    getVerifactuSettings(db, companyId),
    getVerifactuReadiness(db, companyId, process.env, now),
    getCompanyCertificateInfo(db, companyId),
    db
      .select({ total: count(), oldest: min(verifactuRecord.generatedAt) })
      .from(verifactuRecord)
      .where(and(
        sendable,
        environment ? eq(verifactuRecord.environment, environment) : undefined,
        lt(verifactuRecord.generatedAt, new Date(now.getTime() - PENDING_OVERDUE_MS)),
      )),
    // Rechazados que siguen siendo el último registro de su factura (los ya subsanados no cuentan).
    db
      .select({ total: count() })
      .from(verifactuRecord)
      .where(and(
        eq(verifactuRecord.companyId, companyId),
        eq(verifactuRecord.status, "REJECTED"),
        environment ? eq(verifactuRecord.environment, environment) : undefined,
        sql`NOT EXISTS (SELECT 1 FROM "verifactu_record" AS later WHERE later."invoiceId" = ${verifactuRecord.invoiceId} AND later."generatedAt" > ${verifactuRecord.generatedAt})`,
      )),
    environment
      ? db.select({ total: count() }).from(verifactuRecord).where(and(sendable, ne(verifactuRecord.environment, environment)))
      : Promise.resolve([{ total: 0 }]),
  ]);
  return buildVerifactuHealth({
    mode: settings.mode,
    environment,
    environmentProblem: environmentConfig.problem,
    readiness,
    certificate,
    overduePending: Number(overdue?.total ?? 0),
    oldestPendingAt: overdue?.oldest ?? null,
    rejected: Number(rejected?.total ?? 0),
    otherEnvironmentPending: Number(foreign?.total ?? 0),
    now,
  });
}

/** Resumen para la pantalla Fiscalidad › VeriFactu. */
export async function getVerifactuOverview(companyId: string) {
  const environment = readVerifactuEnvironment().environment;
  const [health, settings, readiness, certificate, statusCounts, records, events] = await Promise.all([
    getVerifactuHealth(companyId),
    getVerifactuSettings(db, companyId),
    getVerifactuReadiness(db, companyId),
    getCompanyCertificateInfo(db, companyId),
    db
      .select({ status: verifactuRecord.status, total: count() })
      .from(verifactuRecord)
      .where(and(eq(verifactuRecord.companyId, companyId), environment ? eq(verifactuRecord.environment, environment) : undefined))
      .groupBy(verifactuRecord.status),
    db
      .select({
        id: verifactuRecord.id,
        invoiceId: verifactuRecord.invoiceId,
        sequence: verifactuRecord.sequence,
        recordType: verifactuRecord.recordType,
        mode: verifactuRecord.mode,
        environment: verifactuRecord.environment,
        invoiceNumber: verifactuRecord.invoiceNumber,
        invoiceIssueDate: verifactuRecord.invoiceIssueDate,
        invoiceTypeCode: verifactuRecord.invoiceTypeCode,
        subsanacion: verifactuRecord.subsanacion,
        totalAmount: verifactuRecord.totalAmount,
        hash: verifactuRecord.hash,
        generatedAt: verifactuRecord.generatedAt,
        status: verifactuRecord.status,
        sendAttempts: verifactuRecord.sendAttempts,
        aeatErrorCode: verifactuRecord.aeatErrorCode,
        aeatErrorMessage: verifactuRecord.aeatErrorMessage,
      })
      .from(verifactuRecord)
      .where(eq(verifactuRecord.companyId, companyId))
      // La secuencia es por entorno: el orden común es el de generación.
      .orderBy(desc(verifactuRecord.generatedAt), desc(verifactuRecord.sequence))
      .limit(25),
    db
      .select({
        id: verifactuEvent.id,
        sequence: verifactuEvent.sequence,
        eventType: verifactuEvent.eventType,
        description: verifactuEvent.description,
        createdAt: verifactuEvent.createdAt,
      })
      .from(verifactuEvent)
      .where(and(eq(verifactuEvent.companyId, companyId), environment ? eq(verifactuEvent.environment, environment) : undefined))
      .orderBy(desc(verifactuEvent.createdAt), desc(verifactuEvent.sequence))
      .limit(15),
  ]);
  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, Number(row.total)]));
  const lastVerification = events.find((event) => event.eventType === "CHAIN_VERIFIED" || event.eventType === "ANOMALY_DETECTED") ?? null;
  // Solo el último registro de cada factura se puede subsanar (los anteriores ya están corregidos).
  const latestByInvoice = new Map<string, string>();
  for (const record of records) if (!latestByInvoice.has(record.invoiceId)) latestByInvoice.set(record.invoiceId, record.id);
  const transport = getVerifactuTransportConfig();
  return {
    settings,
    /** Entorno de este despliegue (null si falta declararlo: ver `health`). */
    environment,
    health,
    // "enabled": esta empresa puede remitir ahora (transporte activo y certificado vigente disponible).
    transport: readiness.operational ? { enabled: true as const, reason: null } : { enabled: false as const, reason: readiness.reason ?? "" },
    /** El administrador ha activado el envío a la AEAT (a la empresa puede faltarle el certificado). */
    transportActive: transport.kind === "aeat",
    certificate: { own: certificate, source: readiness.certificate, systemAvailable: transport.kind === "aeat" && Boolean(transport.certPath) },
    counts,
    totalRecords: Object.values(counts).reduce((total, value) => total + value, 0),
    records: records.map((record) => {
      const needsFix = record.recordType === "ALTA"
        && record.mode === "VERIFACTU"
        && (record.status === "REJECTED" || record.status === "ACCEPTED_WITH_ERRORS")
        && latestByInvoice.get(record.invoiceId) === record.id;
      // No se ofrece «Subsanar» cuando no arreglaría nada (2004, 2009) o cuando procede rectificativa.
      const block = needsFix ? subsanacionBlockFor({ code: record.aeatErrorCode, message: record.aeatErrorMessage }) : null;
      return {
        ...record,
        isTest: record.environment === "test",
        canSubsanar: needsFix && !block && environment !== null && record.environment === environment,
        subsanarHint: block?.message ?? null,
      };
    }),
    events,
    lastVerification,
  };
}

async function loadEnvironmentRecords(companyId: string, environment: VerifactuEnvironment) {
  return db
    .select()
    .from(verifactuRecord)
    .where(and(eq(verifactuRecord.companyId, companyId), eq(verifactuRecord.environment, environment)))
    .orderBy(asc(verifactuRecord.sequence));
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const decimalComma = (value: string | null) => (value ? value.replace(".", ",") : "");

/**
 * Exportación de los registros (CSV para Excel en español o XML con la estructura AEAT). Se
 * exporta la cadena del entorno de este despliegue: las de pruebas y producción no se mezclan.
 */
export async function exportVerifactuRecords(companyId: string, format: "csv" | "xml", actorUserId: string | null) {
  const environment = requireVerifactuEnvironment();
  const records = await loadEnvironmentRecords(companyId, environment);
  const settings = await getVerifactuSettings(db, companyId);
  let content: string;
  if (format === "xml") {
    content = buildRecordsExportXml({ issuer: { name: settings.issuerName, taxId: settings.issuerTaxId ?? "" }, records: records as XmlRecord[] });
  } else {
    const header = ["N.º", "Entorno", "Tipo registro", "Modo", "NIF emisor", "N.º factura", "Fecha expedición", "Tipo factura", "Cuota total", "Importe total", "Huella anterior", "Huella", "Fecha/hora generación", "Estado", "CSV AEAT", "Error AEAT"];
    const rows = records.map((record) => [
      record.sequence,
      isVerifactuEnvironment(record.environment) ? verifactuEnvironmentLabels[record.environment] : record.environment,
      record.recordType,
      record.mode,
      record.issuerTaxId,
      record.invoiceNumber,
      record.invoiceIssueDate,
      record.invoiceTypeCode,
      decimalComma(record.taxAmount),
      decimalComma(record.totalAmount),
      record.previousHash,
      record.hash,
      record.generatedAtText,
      verifactuStatusLabels[record.status] ?? record.status,
      record.aeatCsv,
      [record.aeatErrorCode, record.aeatErrorMessage].filter(Boolean).join(" "),
    ].map(csvCell).join(";"));
    content = `﻿${[header.join(";"), ...rows].join("\r\n")}\r\n`;
  }
  await db.transaction((tx) => appendEvent(tx, {
    companyId,
    environment,
    eventType: "EXPORT",
    description: `Exportación de ${records.length} registro(s) de facturación en ${format.toUpperCase()}.`,
    payload: { format, records: records.length },
    actorUserId,
  }));
  return {
    filename: `verifactu-registros-${environment === "test" ? "pruebas-" : ""}${new Date().toISOString().slice(0, 10)}.${format}`,
    contentType: format === "xml" ? "application/xml; charset=utf-8" : "text/csv; charset=utf-8",
    content,
  };
}

export type InvoiceVerifactuInfo = {
  mode: "VERIFACTU" | "NO_VERIFACTU";
  /** Entorno de la AEAT en el que nació el registro. */
  environment: VerifactuEnvironment;
  /** El registro es del entorno de pruebas: la factura no consta en Hacienda. */
  isTest: boolean;
  status: string;
  statusLabel: string;
  invoiceTypeCode: string | null;
  hash: string;
  sequence: number;
  url: string;
  /** Texto que va encima del QR ("QR tributario:"). */
  caption: string;
  /**
   * Leyenda bajo el QR: «VERI*FACTU» si el envío está operativo; el rótulo de entorno de pruebas
   * si el registro es de pruebas; vacía en otro caso.
   */
  legends: string[];
  errorMessage: string | null;
};

/** QR y estado del último alta de una factura (null si no tiene registro). */
export async function getInvoiceVerifactuInfo(companyId: string, invoiceId: string): Promise<InvoiceVerifactuInfo | null> {
  const [record] = await db
    .select()
    .from(verifactuRecord)
    .where(and(eq(verifactuRecord.companyId, companyId), eq(verifactuRecord.invoiceId, invoiceId), eq(verifactuRecord.recordType, "ALTA")))
    .orderBy(desc(verifactuRecord.generatedAt), desc(verifactuRecord.sequence))
    .limit(1);
  if (!record) return null;
  const mode = record.mode === "NO_VERIFACTU" ? "NO_VERIFACTU" : "VERIFACTU";
  // El entorno es el del registro: de él salen la URL del QR y el rótulo, se pinte donde se pinte.
  const environment: VerifactuEnvironment = record.environment === "production" ? "production" : "test";
  const readiness = mode === "VERIFACTU" && environment === "production" ? await getVerifactuReadiness(db, companyId) : null;
  return {
    mode,
    environment,
    isTest: environment === "test",
    status: record.status,
    statusLabel: verifactuStatusLabels[record.status] ?? record.status,
    invoiceTypeCode: record.invoiceTypeCode,
    hash: record.hash,
    sequence: record.sequence,
    url: buildVerifactuQrUrl({
      mode,
      environment,
      issuerTaxId: record.issuerTaxId,
      invoiceNumber: record.invoiceNumber,
      invoiceIssueDate: record.invoiceIssueDate,
      totalAmount: record.totalAmount ?? "0.00",
    }),
    caption: QR_CAPTION,
    legends: verifactuLegends(mode, Boolean(readiness?.operational) && record.status !== "REJECTED", environment),
    errorMessage: record.aeatErrorMessage,
  };
}

export async function getInvoiceVerifactuQrPng(info: InvoiceVerifactuInfo) {
  return renderQrPngDataUrl(info.url);
}

export async function getInvoiceVerifactuQrSvg(info: InvoiceVerifactuInfo) {
  return renderQrSvg(info.url);
}
