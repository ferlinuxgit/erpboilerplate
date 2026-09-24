import ExcelJS from "exceljs";

import { getReportingPeriodRanges, type ReportingPeriod } from "@/lib/reporting-period";
import { loadDashboardFinance } from "@/server/reporting/dashboard";
import { buildFinancialKpis } from "@/server/reporting/financial-kpis";

export { getReportingPeriodRanges };
export type { ReportingPeriod };

/** Financial indicators of a period, computed with the same SQL aggregates as the dashboard. */
export async function loadReportingKpis(companyId: string, period: ReportingPeriod = "month", options: { countryCode?: string; now?: Date } = {}) {
  const finance = await loadDashboardFinance(companyId, { period, ...options });
  return { finance, kpis: buildFinancialKpis(finance) };
}

const MONEY_FORMAT = '#,##0.00 "€";-#,##0.00 "€"';

function styleHeader(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/** Excel export: the same indicators as the reporting page plus the 12-month series and aging. */
export async function exportKpisExcel(companyId: string, period: ReportingPeriod = "month", options: { countryCode?: string; now?: Date } = {}) {
  const { finance, kpis } = await loadReportingKpis(companyId, period, options);
  const workbook = new ExcelJS.Workbook();
  const endInclusive = new Date(finance.ranges.current.end.getTime() - 1);

  const summary = workbook.addWorksheet("Indicadores");
  summary.columns = [
    { header: "Indicador", key: "label", width: 34 },
    { header: "Valor", key: "value", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Periodo anterior", key: "previous", width: 18, style: { numFmt: MONEY_FORMAT } },
    { header: "Variación %", key: "change", width: 12 },
    { header: "Cómo se calcula", key: "description", width: 80 },
  ];
  kpis.forEach((kpi) => summary.addRow({ label: kpi.label, value: kpi.value, previous: kpi.previous, change: kpi.change, description: kpi.description }));
  summary.addRow({});
  summary.addRow({ label: "Periodo", description: `${finance.ranges.current.start.toISOString().slice(0, 10)} a ${endInclusive.toISOString().slice(0, 10)}` });
  styleHeader(summary);

  const monthly = workbook.addWorksheet("Mensual");
  monthly.columns = [
    { header: "Mes", key: "month", width: 12 },
    { header: "Ventas (sin IVA)", key: "sales", width: 18, style: { numFmt: MONEY_FORMAT } },
    { header: "Compras y gastos (sin IVA)", key: "expenses", width: 26, style: { numFmt: MONEY_FORMAT } },
    { header: "Saldo en bancos a fin de mes", key: "bank", width: 28, style: { numFmt: MONEY_FORMAT } },
  ];
  finance.months.forEach((month, index) =>
    monthly.addRow({ month: month.key, sales: finance.monthly.sales[index], expenses: finance.monthly.expenses[index], bank: finance.bank.series[index] }),
  );
  styleHeader(monthly);

  const aging = workbook.addWorksheet("Antigüedad cobros");
  aging.columns = [
    { header: "Tramo", key: "label", width: 18 },
    { header: "Facturas", key: "count", width: 10 },
    { header: "Importe pendiente", key: "amount", width: 20, style: { numFmt: MONEY_FORMAT } },
  ];
  finance.receivables.aging.buckets.forEach((bucket) => aging.addRow({ label: bucket.label, count: bucket.count, amount: bucket.amount }));
  aging.addRow({ label: "Total", count: finance.receivables.aging.count, amount: finance.receivables.aging.total });
  styleHeader(aging);

  return workbook.xlsx.writeBuffer();
}
