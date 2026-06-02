import { and, desc, eq, ne } from "drizzle-orm";

import { fiscalReport } from "@/db/schema";
import { db } from "@/lib/db";
import {
  isSpanishFiscalModelCode,
  normalizeSpanishFiscalCode,
  normalizeSpanishFiscalPeriod,
  type FiscalReportStatus,
} from "@/lib/fiscal-spain";
import { recordAudit } from "@/server/audit";
import { calculateSpanishFiscalSummary, type SpanishFiscalSummary } from "@/server/fiscal/spain";

type FiscalReportPayload = {
  code: string;
  period: string;
  status: FiscalReportStatus;
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
  if (!normalized) throw new Error("Modelo o periodo fiscal español no soportado.");
  await assertFiscalReportKeyAvailable(companyId, normalized.code, normalized.period);

  const [created] = await db.insert(fiscalReport).values({
    companyId,
    code: normalized.code,
    period: normalized.period,
    status: normalized.status,
    filedAt: normalized.status === "FILED" ? new Date() : null,
  }).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "fiscal.create", entityName: "fiscalReport", entityId: created.id, payload: normalized });
  return created;
}

export async function updateFiscalReport(companyId: string, tenantId: string, actorUserId: string, id: string, payload: FiscalReportPayload) {
  const normalized = normalizeFiscalReportPayload(payload);
  if (!normalized) throw new Error("Modelo o periodo fiscal español no soportado.");
  await assertFiscalReportKeyAvailable(companyId, normalized.code, normalized.period, id);

  const current = await getFiscalReport(companyId, id);
  if (!current) return null;

  const [updated] = await db
    .update(fiscalReport)
    .set({
      ...normalized,
      filedAt: normalized.status === "FILED" ? current.filedAt ?? new Date() : null,
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
      payload: { from: current.status, to: normalized.status, code: normalized.code, period: normalized.period },
    });
  }
  return updated;
}

export async function deleteFiscalReport(companyId: string, tenantId: string, actorUserId: string, id: string) {
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
    throw new Error("Ya existe un borrador fiscal para ese modelo y periodo.");
  }
}
