import type { DashboardFinance } from "@/server/reporting/dashboard";
import { financePeriodOptions } from "@/server/reporting/dashboard-model";

export type FinancialKpi = {
  key: string;
  label: string;
  value: number;
  /** Same stretch of the previous period, when the indicator has one. */
  previous: number | null;
  /** Percentage change vs `previous` (null without a base). */
  change: number | null;
  description: string;
  href: string;
};

/**
 * Single definition of the financial indicators shown in the dashboard, the reporting page
 * and the Excel export, so the three always show the same figures with the same names.
 */
export function buildFinancialKpis(finance: DashboardFinance): FinancialKpi[] {
  const period = financePeriodOptions.find((option) => option.value === finance.period) ?? financePeriodOptions[0];
  return [
    {
      key: "sales",
      label: "Ventas facturadas",
      value: finance.sales.current,
      previous: finance.sales.previous,
      change: finance.sales.change,
      description: `Base imponible de las facturas emitidas (${period.label.toLocaleLowerCase()}), sin borradores ni anuladas y restando las rectificativas; comparado con el ${period.previousLabel}.`,
      href: "/invoices",
    },
    {
      key: "expenses",
      label: "Compras y gastos",
      value: finance.expenses.current,
      previous: finance.expenses.previous,
      change: null,
      description: "Base imponible de las facturas de proveedor del periodo, sin anuladas ni borradores.",
      href: "/expenses",
    },
    {
      key: "grossMargin",
      label: "Margen bruto aproximado",
      value: finance.grossMargin.amount,
      previous: null,
      change: null,
      description: "Ventas menos compras y gastos del periodo, sin IVA.",
      href: "/reporting",
    },
    {
      key: "receivables",
      label: "Cobros pendientes",
      value: finance.receivables.aging.total,
      previous: null,
      change: null,
      description: `Importe pendiente de cobro de facturas emitidas abiertas, descontando rectificativas y cobros; ${finance.receivables.aging.overdue.toFixed(2)} ya vencido.`,
      href: "/invoices",
    },
    {
      key: "payables",
      label: "Pagos pendientes a proveedores",
      value: finance.payables.amount,
      previous: null,
      change: null,
      description: "Importe pendiente de pago de facturas de proveedor abiertas.",
      href: "/expenses",
    },
    {
      key: "bank",
      label: "Saldo en bancos",
      value: finance.bank.balance,
      previous: null,
      change: null,
      description: "Saldo contable de las cuentas de bancos vinculadas y la cuenta de bancos por defecto.",
      href: "/treasury",
    },
    {
      key: "vat",
      label: `IVA estimado ${finance.vat.label}`,
      value: finance.vat.result,
      previous: null,
      change: null,
      description: "IVA repercutido (sin borradores y restando rectificativas) menos IVA soportado deducible del trimestre natural (estimación; el 303 definitivo está en Fiscal).",
      href: "/fiscal",
    },
  ];
}
