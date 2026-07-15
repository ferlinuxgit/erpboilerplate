import { and, eq, sql } from "drizzle-orm";

import { fiscalReport, fiscalYear } from "@/db/schema";
import { isSpanishFiscalModelCode, parseSpanishFiscalPeriod } from "@/lib/fiscal-spain";
import type { DbClient } from "@/lib/db";

export type FiscalLockResult = {
  locked: boolean;
  reportId?: string;
  code?: string;
  period?: string;
};

export async function findFiscalPeriodLock(companyId: string, date: Date, dbClient?: DbClient): Promise<FiscalLockResult> {
  const client = dbClient ?? (await import("@/lib/db")).db;
  const reports = await client
    .select({
      id: fiscalReport.id,
      code: fiscalReport.code,
      period: fiscalReport.period,
    })
    .from(fiscalReport)
    .where(and(eq(fiscalReport.companyId, companyId), eq(fiscalReport.status, "FILED")));

  for (const report of reports) {
    if (!isSpanishFiscalModelCode(report.code)) continue;

    const range = parseSpanishFiscalPeriod(report.period, report.code);
    if (!range) continue;

    if (date >= range.start && date < range.endExclusive) {
      return {
        locked: true,
        reportId: report.id,
        code: report.code,
        period: report.period,
      };
    }
  }

  return { locked: false };
}

export async function assertFiscalPeriodOpen(companyId: string, date: Date, dbClient?: DbClient) {
  if (Number.isNaN(date.getTime())) throw new Error("La fecha contable no es válida.");
  const client = dbClient ?? (await import("@/lib/db")).db;
  const [year] = await client
    .select({ code: fiscalYear.code, isClosed: fiscalYear.isClosed })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.companyId, companyId), sql`${date} >= ${fiscalYear.startsAt}`, sql`${date} <= ${fiscalYear.endsAt}`))
    .limit(1);
  if (!year) throw new Error("La fecha no pertenece a ningún ejercicio fiscal de la empresa.");
  if (year.isClosed) throw new Error(`El ejercicio fiscal ${year.code} está cerrado.`);
  const lock = await findFiscalPeriodLock(companyId, date, dbClient);
  if (!lock.locked) return;

  throw new Error(`El periodo fiscal ${lock.period} del modelo ${lock.code} ya está presentado y bloqueado.`);
}
