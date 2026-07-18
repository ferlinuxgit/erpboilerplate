import { and, desc, eq, gte, lt } from "drizzle-orm";
import ExcelJS from "exceljs";

import { kpiSnapshot } from "@/db/schema";
import { db } from "@/lib/db";
import { getReportingPeriodRanges, type ReportingPeriod } from "@/lib/reporting-period";

export { getReportingPeriodRanges };
export type { ReportingPeriod };

export async function listKpis(companyId: string, range?: { start: Date; end: Date }) {
  return db
    .select()
    .from(kpiSnapshot)
    .where(range ? and(eq(kpiSnapshot.companyId, companyId), gte(kpiSnapshot.capturedAt, range.start), lt(kpiSnapshot.capturedAt, range.end)) : eq(kpiSnapshot.companyId, companyId))
    .orderBy(desc(kpiSnapshot.capturedAt));
}

export async function exportKpisExcel(companyId: string, period: ReportingPeriod = "month") {
  const rows = await listKpis(companyId, getReportingPeriodRanges(period).current);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("KPIs");
  sheet.columns = [
    { header: "Metrica", key: "metricKey" },
    { header: "Valor", key: "metricValue" },
    { header: "Capturado", key: "capturedAt" },
  ];
  rows.forEach((row) => {
    sheet.addRow({ metricKey: row.metricKey, metricValue: row.metricValue.toString(), capturedAt: row.capturedAt.toISOString() });
  });
  return workbook.xlsx.writeBuffer();
}
