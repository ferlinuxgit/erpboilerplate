import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";

import { kpiSnapshot } from "@/db/schema";
import { db } from "@/lib/db";

export async function listKpis(companyId: string) {
  return db.select().from(kpiSnapshot).where(eq(kpiSnapshot.companyId, companyId));
}

export async function exportKpisExcel(companyId: string) {
  const rows = await listKpis(companyId);
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
