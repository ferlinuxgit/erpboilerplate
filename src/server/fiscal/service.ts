import { desc, eq } from "drizzle-orm";

import { fiscalReport } from "@/db/schema";
import { db } from "@/lib/db";
import { recordAudit } from "@/server/audit";

export async function listFiscalReports(companyId: string) {
  return db.select().from(fiscalReport).where(eq(fiscalReport.companyId, companyId)).orderBy(desc(fiscalReport.period));
}

export async function getFiscalReport(companyId: string, id: string) {
  const rows = await db.select().from(fiscalReport).where(eq(fiscalReport.companyId, companyId));
  return rows.find((row) => row.id === id) ?? null;
}

export async function createFiscalReport(companyId: string, tenantId: string, actorUserId: string, payload: { code: string; period: string; status: "DRAFT" | "READY" | "FILED" }) {
  const [created] = await db.insert(fiscalReport).values({ companyId, code: payload.code, period: payload.period, status: payload.status }).returning();
  await recordAudit({ tenantId, companyId, actorUserId, action: "fiscal.create", entityName: "fiscalReport", entityId: created.id, payload });
  return created;
}

export async function updateFiscalReport(companyId: string, tenantId: string, actorUserId: string, id: string, payload: { code: string; period: string; status: "DRAFT" | "READY" | "FILED" }) {
  const [updated] = await db.update(fiscalReport).set(payload).where(eq(fiscalReport.id, id)).returning();
  if (!updated) return null;
  await recordAudit({ tenantId, companyId, actorUserId, action: "fiscal.update", entityName: "fiscalReport", entityId: id, payload });
  return updated;
}

export async function deleteFiscalReport(companyId: string, tenantId: string, actorUserId: string, id: string) {
  const report = await getFiscalReport(companyId, id);
  if (!report) return false;
  await db.delete(fiscalReport).where(eq(fiscalReport.id, id));
  await recordAudit({ tenantId, companyId, actorUserId, action: "fiscal.delete", entityName: "fiscalReport", entityId: id });
  return true;
}
