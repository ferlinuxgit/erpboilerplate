import { and, desc, eq, ne } from "drizzle-orm";

import { fiscalReport } from "@/db/schema";
import { db } from "@/lib/db";
import {
  isSpanishFiscalModelCode,
  normalizeSpanishFiscalCode,
  normalizeSpanishFiscalPeriod,
  type FiscalReportStatus,
} from "@/lib/fiscal-spain";
import { AccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";
import { calculateSpanishFiscalSummary, type SpanishFiscalSummary } from "@/server/fiscal/spain";

type FiscalReportPayload = {
  code: string;
  period: string;
  status: FiscalReportStatus;
  reopenReason?: string;
};

export type FiscalReportWithSummary = Awaited<ReturnType<typeof listFiscalReports>>[number] & {
  summary: SpanishFiscalSummary | null;
};

export function normalizeFiscalReportPayload(payload: FiscalReportPayload) {
  const code = normalizeSpanishFiscalCode(payload.code);
  if (!isSpanishFiscalModelCode(code)) return null;

  const period = normalizeSpanishFiscalPeriod(payload.period, code);
  if (!period) return null;

  return {
    code,
    period,
    status: payload.status,
  };
}

export async function listFiscalReports(companyId: string) {
  return db.select().from(fiscalReport).where(eq(fiscalReport.companyId, companyId)).orderBy(desc(fiscalReport.period), desc(fiscalReport.updatedAt));
}

export async function listFiscalReportsWithSummary(companyId: string): Promise<FiscalReportWithSummary[]> {
  const reports = await listFiscalReports(companyId);

  return Promise.all(
    reports.map(async (report) => ({
      ...report,
      summary: isSpanishFiscalModelCode(report.code) ? await calculateSpanishFiscalSummary(companyId, report.code, report.period) : null,
    })),
  );
}

export async function getFiscalReport(companyId: string, id: string) {
  const [row] = await db.select().from(fiscalReport).where(and(eq(fiscalReport.id, id), eq(fiscalReport.companyId, companyId)));
  return row ?? null;
}

export async function createFiscalReport(companyId: string, tenantId: string, actorUserId: string, payload: FiscalReportPayload) {
  const normalized = normalizeFiscalReportPayload(payload);
  if (!normalized) throw new AccountingRuleError(422, "FISCAL_PERIOD_INVALID", "Modelo o periodo fiscal no soportado. Usa 2026-Q1, 2026-04 o 2026 según el modelo.");
  if (normalized.status === "FILED") {
    throw new AccountingRuleError(422, "FILING_DATA_REQUIRED", "Crea el modelo como borrador y márcalo como presentado con la fecha y el número de justificante.");
  }
  await assertFiscalReportKeyAvailable(companyId, normalized.code, normalized.period);

  const [created] = await db.insert(fiscalReport).values({
    companyId,
    code: normalized.code,
    period: normalized.period,
    status: normalized.status,
  }).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "fiscal.create", entityName: "fiscalReport", entityId: created.id, payload: normalized });
  return created;
}

export async function updateFiscalReport(companyId: string, tenantId: string, actorUserId: string, id: string, payload: FiscalReportPayload) {
  const normalized = normalizeFiscalReportPayload(payload);
  if (!normalized) throw new AccountingRuleError(422, "FISCAL_PERIOD_INVALID", "Modelo o periodo fiscal no soportado. Usa 2026-Q1, 2026-04 o 2026 según el modelo.");
  await assertFiscalReportKeyAvailable(companyId, normalized.code, normalized.period, id);

  const current = await getFiscalReport(companyId, id);
  if (!current) return null;
  if (current.status !== "FILED" && normalized.status === "FILED") {
    throw new AccountingRuleError(422, "FILING_DATA_REQUIRED", "Para marcarlo como presentado usa «Marcar como presentado»: pide la fecha y el número de justificante.");
  }
  if (current.status === "FILED" && normalized.status !== "FILED" && !payload.reopenReason?.trim()) {
    throw new AccountingRuleError(422, "REOPEN_REASON_REQUIRED", "Debes indicar el motivo para reabrir una declaración presentada.");
  }

  const [updated] = await db
    .update(fiscalReport)
    .set({
      ...normalized,
      filedAt: normalized.status === "FILED" ? current.filedAt ?? new Date() : null,
      ...(normalized.status === "FILED" ? {} : { filingReceiptNumber: null, paymentNrc: null }),
      updatedAt: new Date(),
    })
    .where(and(eq(fiscalReport.id, id), eq(fiscalReport.companyId, companyId)))
    .returning();
  if (!updated) return null;
  await recordAudit({ tenantId, companyId, actorUserId, action: "fiscal.update", entityName: "fiscalReport", entityId: id, payload: normalized });
  if (current.status === "FILED" && normalized.status !== "FILED") {
    await recordAudit({
      tenantId,
      companyId,
      actorUserId,
      action: "fiscal.reopen",
      entityName: "fiscalReport",
      entityId: id,
      payload: { from: current.status, to: normalized.status, code: normalized.code, period: normalized.period, reason: payload.reopenReason?.trim() },
    });
  }
  return updated;
}

export type MarkFiledPayload = {
  filedAt: Date;
  /** Número de justificante de la presentación (AEAT). */
  receiptNumber: string;
  /** NRC del pago en el banco, si el modelo salió a ingresar. */
  nrc?: string | null;
};

/** Normaliza y valida los datos de presentación (función pura). Devuelve el mensaje de error o los datos. */
export function normalizeMarkFiledPayload(payload: MarkFiledPayload, now = new Date()): { error: string } | { data: { filedAt: Date; receiptNumber: string; nrc: string | null } } {
  if (Number.isNaN(payload.filedAt.getTime())) return { error: "La fecha de presentación no es válida." };
  const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  if (payload.filedAt.getTime() >= endOfToday) return { error: "La fecha de presentación no puede ser futura." };
  const receiptNumber = payload.receiptNumber.replace(/\s+/g, "").toUpperCase();
  if (!/^[0-9A-Z-]{6,40}$/.test(receiptNumber)) return { error: "Indica el número de justificante que aparece en el documento de la AEAT (solo números y letras)." };
  const nrc = payload.nrc?.replace(/\s+/g, "").toUpperCase() || null;
  if (nrc && !/^[0-9A-Z]{10,40}$/.test(nrc)) return { error: "El NRC tiene que tener entre 10 y 40 números o letras." };
  return { data: { filedAt: payload.filedAt, receiptNumber, nrc } };
}

/**
 * Marca un modelo como presentado con su fecha, justificante y (si hubo pago) NRC.
 * Bloquea el periodo: ya no se pueden registrar documentos con fecha dentro de él.
 */
export async function markFiscalReportFiled(companyId: string, tenantId: string, actorUserId: string, id: string, payload: MarkFiledPayload) {
  const normalized = normalizeMarkFiledPayload(payload);
  if ("error" in normalized) throw new AccountingRuleError(422, "FISCAL_FILING_INVALID", normalized.error);
  const current = await getFiscalReport(companyId, id);
  if (!current) return null;
  if (current.status === "FILED") throw new AccountingRuleError(409, "FISCAL_REPORT_FILED", "Este modelo ya está marcado como presentado.");

  const [updated] = await db
    .update(fiscalReport)
    .set({
      status: "FILED",
      filedAt: normalized.data.filedAt,
      filingReceiptNumber: normalized.data.receiptNumber,
      paymentNrc: normalized.data.nrc,
      updatedAt: new Date(),
    })
    .where(and(eq(fiscalReport.id, id), eq(fiscalReport.companyId, companyId)))
    .returning();
  if (!updated) return null;
  await recordAudit({
    tenantId,
    companyId,
    actorUserId,
    action: "fiscal.file",
    entityName: "fiscalReport",
    entityId: id,
    payload: { code: current.code, period: current.period, filedAt: normalized.data.filedAt, receiptNumber: normalized.data.receiptNumber, nrc: normalized.data.nrc },
  });
  return updated;
}

export async function deleteFiscalReport(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const current = await getFiscalReport(companyId, id);
  if (!current) return false;
  if (current.status === "FILED") throw new AccountingRuleError(409, "FISCAL_REPORT_FILED", "No se puede eliminar una declaración presentada; debes reabrirla primero.");
  const [deleted] = await db
    .delete(fiscalReport)
    .where(and(eq(fiscalReport.id, id), eq(fiscalReport.companyId, companyId)))
    .returning({ id: fiscalReport.id });
  if (!deleted) return false;
  await recordAudit({ tenantId, companyId, actorUserId, action: "fiscal.delete", entityName: "fiscalReport", entityId: id });
  return true;
}

async function assertFiscalReportKeyAvailable(companyId: string, code: string, period: string, exceptId?: string) {
  const duplicate = await db
    .select({ id: fiscalReport.id })
    .from(fiscalReport)
    .where(
      exceptId
        ? and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.code, code), eq(fiscalReport.period, period), ne(fiscalReport.id, exceptId))
        : and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.code, code), eq(fiscalReport.period, period)),
    )
    .limit(1);

  if (duplicate.length > 0) {
    throw new AccountingRuleError(409, "FISCAL_REPORT_DUPLICATE", "Ya existe un borrador fiscal para ese modelo y periodo.");
  }
}
