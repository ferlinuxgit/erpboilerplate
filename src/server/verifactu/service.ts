import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { verifactuEvent, verifactuRecord } from "@/db/schema";
import { db } from "@/lib/db";
import { getCompanyCertificateInfo, getVerifactuReadiness } from "@/server/verifactu/certificates";
import { appendEvent } from "@/server/verifactu/chain";
import { getVerifactuEnvironment, getVerifactuTransportConfig } from "@/server/verifactu/config";
import { buildVerifactuQrUrl, QR_CAPTION, renderQrPngDataUrl, renderQrSvg, verifactuLegends } from "@/server/verifactu/qr";
import { getVerifactuSettings } from "@/server/verifactu/settings";
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

/** Resumen para la pantalla Fiscalidad › VeriFactu. */
export async function getVerifactuOverview(companyId: string) {
  const [settings, readiness, certificate, statusCounts, records, events] = await Promise.all([
    getVerifactuSettings(db, companyId),
    getVerifactuReadiness(db, companyId),
    getCompanyCertificateInfo(db, companyId),
    db
      .select({ status: verifactuRecord.status, total: count() })
      .from(verifactuRecord)
      .where(eq(verifactuRecord.companyId, companyId))
      .groupBy(verifactuRecord.status),
    db
      .select({
        id: verifactuRecord.id,
        invoiceId: verifactuRecord.invoiceId,
        sequence: verifactuRecord.sequence,
        recordType: verifactuRecord.recordType,
        mode: verifactuRecord.mode,
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
      .orderBy(desc(verifactuRecord.sequence))
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
      .where(eq(verifactuEvent.companyId, companyId))
      .orderBy(desc(verifactuEvent.sequence))
      .limit(15),
  ]);
  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, Number(row.total)]));
  const lastVerification = events.find((event) => event.eventType === "CHAIN_VERIFIED" || event.eventType === "ANOMALY_DETECTED") ?? null;
  // Solo el último registro de cada factura se puede subsanar (los anteriores ya están corregidos).
  const latestByInvoice = new Map<string, number>();
  for (const record of records) latestByInvoice.set(record.invoiceId, Math.max(latestByInvoice.get(record.invoiceId) ?? 0, record.sequence));
  const transport = getVerifactuTransportConfig();
  return {
    settings,
    environment: getVerifactuEnvironment(),
    // "enabled": esta empresa puede remitir ahora (transporte activo y certificado disponible).
    transport: readiness.operational ? { enabled: true as const, reason: null } : { enabled: false as const, reason: readiness.reason ?? "" },
    /** El administrador ha activado el envío a la AEAT (a la empresa puede faltarle el certificado). */
    transportActive: transport.kind === "aeat",
    certificate: { own: certificate, source: readiness.certificate, systemAvailable: transport.kind === "aeat" && Boolean(transport.certPath) },
    counts,
    totalRecords: Object.values(counts).reduce((total, value) => total + value, 0),
    records: records.map((record) => ({
      ...record,
      canSubsanar: record.recordType === "ALTA"
        && record.mode === "VERIFACTU"
        && (record.status === "REJECTED" || record.status === "ACCEPTED_WITH_ERRORS")
        && latestByInvoice.get(record.invoiceId) === record.sequence,
    })),
    events,
    lastVerification,
  };
}

async function loadAllRecords(companyId: string) {
  return db.select().from(verifactuRecord).where(eq(verifactuRecord.companyId, companyId)).orderBy(asc(verifactuRecord.sequence));
}

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const decimalComma = (value: string | null) => (value ? value.replace(".", ",") : "");

/** Exportación de los registros (CSV para Excel en español o XML con la estructura AEAT). */
export async function exportVerifactuRecords(companyId: string, format: "csv" | "xml", actorUserId: string | null) {
  const records = await loadAllRecords(companyId);
  const settings = await getVerifactuSettings(db, companyId);
  let content: string;
  if (format === "xml") {
    content = buildRecordsExportXml({ issuer: { name: settings.issuerName, taxId: settings.issuerTaxId ?? "" }, records: records as XmlRecord[] });
  } else {
    const header = ["N.º", "Tipo registro", "Modo", "NIF emisor", "N.º factura", "Fecha expedición", "Tipo factura", "Cuota total", "Importe total", "Huella anterior", "Huella", "Fecha/hora generación", "Estado", "CSV AEAT", "Error AEAT"];
    const rows = records.map((record) => [
      record.sequence,
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
    content = `\uFEFF${[header.join(";"), ...rows].join("\r\n")}\r\n`;
  }
  await db.transaction((tx) => appendEvent(tx, {
    companyId,
    eventType: "EXPORT",
    description: `Exportación de ${records.length} registro(s) de facturación en ${format.toUpperCase()}.`,
    payload: { format, records: records.length },
    actorUserId,
  }));
  return {
    filename: `verifactu-registros-${new Date().toISOString().slice(0, 10)}.${format}`,
    contentType: format === "xml" ? "application/xml; charset=utf-8" : "text/csv; charset=utf-8",
    content,
  };
}

export type InvoiceVerifactuInfo = {
  mode: "VERIFACTU" | "NO_VERIFACTU";
  status: string;
  statusLabel: string;
  invoiceTypeCode: string | null;
  hash: string;
  sequence: number;
  url: string;
  /** Texto que va encima del QR ("QR tributario:"). */
  caption: string;
  /** Leyenda bajo el QR; vacía si el envío a la AEAT no está operativo. */
  legends: string[];
  errorMessage: string | null;
};

/** QR y estado del último alta de una factura (null si no tiene registro). */
export async function getInvoiceVerifactuInfo(companyId: string, invoiceId: string): Promise<InvoiceVerifactuInfo | null> {
  const [record] = await db
    .select()
    .from(verifactuRecord)
    .where(and(eq(verifactuRecord.companyId, companyId), eq(verifactuRecord.invoiceId, invoiceId), inArray(verifactuRecord.recordType, ["ALTA"])))
    .orderBy(desc(verifactuRecord.sequence))
    .limit(1);
  if (!record) return null;
  const mode = record.mode === "NO_VERIFACTU" ? "NO_VERIFACTU" : "VERIFACTU";
  const readiness = mode === "VERIFACTU" ? await getVerifactuReadiness(db, companyId) : null;
  return {
    mode,
    status: record.status,
    statusLabel: verifactuStatusLabels[record.status] ?? record.status,
    invoiceTypeCode: record.invoiceTypeCode,
    hash: record.hash,
    sequence: record.sequence,
    url: buildVerifactuQrUrl({
      mode,
      issuerTaxId: record.issuerTaxId,
      invoiceNumber: record.invoiceNumber,
      invoiceIssueDate: record.invoiceIssueDate,
      totalAmount: record.totalAmount ?? "0.00",
    }),
    caption: QR_CAPTION,
    legends: verifactuLegends(mode, Boolean(readiness?.operational) && record.status !== "REJECTED"),
    errorMessage: record.aeatErrorMessage,
  };
}

export async function getInvoiceVerifactuQrPng(info: InvoiceVerifactuInfo) {
  return renderQrPngDataUrl(info.url);
}

export async function getInvoiceVerifactuQrSvg(info: InvoiceVerifactuInfo) {
  return renderQrSvg(info.url);
}
