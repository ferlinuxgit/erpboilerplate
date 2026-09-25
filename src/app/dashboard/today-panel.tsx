import Link from "next/link";
import { ArrowRight, Bank, CalendarCheck, Receipt, Warning } from "@phosphor-icons/react/dist/ssr";

import { PageSection } from "@/components/ui/page";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardFinance } from "@/server/reporting/dashboard";

function dayCount(days: number) {
  return `${days} ${days === 1 ? "día" : "días"}`;
}

/**
 * "Qué hacer hoy": cobros vencidos, pagos de la semana, movimientos sin conciliar y plazos
 * fiscales. Se muestra a todos los roles desde el primer día (también sin datos financieros).
 */
export function TodayPanel({ finance, currencyCode }: { finance: DashboardFinance; currencyCode: string }) {
  const money = (value: number) => formatMoney(value, currencyCode);
  const hasTodayItems =
    finance.receivables.overdueInvoices.length > 0 ||
    finance.payables.dueSoon.length > 0 ||
    finance.unreconciledMovements > 0 ||
    finance.fiscalDeadlines.length > 0;

  return (
    <PageSection
      contentClassName="grid gap-2 md:grid-cols-2"
      data-testid="dashboard-today"
      description="Lo más urgente para cobrar, pagar y cumplir plazos."
      title="Qué hacer hoy"
    >
      {!hasTodayItems ? (
        <p className="border border-dashed border-window-dark-shadow p-2.5 text-xs text-muted-foreground md:col-span-2">
          Nada urgente: no hay cobros vencidos, pagos esta semana, movimientos sin conciliar ni plazos fiscales en los próximos 30 días.
        </p>
      ) : null}

      {finance.receivables.overdueInvoices.length > 0 ? (
        <div className="space-y-1.5 border border-window-shadow p-2.5">
          <h3 className="flex items-center gap-1.5 font-mono text-xs font-bold">
            <Warning aria-hidden="true" className="size-4 text-warning" />
            Reclama {finance.receivables.overdueCount} {finance.receivables.overdueCount === 1 ? "factura vencida" : "facturas vencidas"} ({money(finance.receivables.overdueAmount)})
          </h3>
          <ul className="divide-y divide-window-shadow">
            {finance.receivables.overdueInvoices.map((entry) => (
              <li key={entry.id}>
                <Link className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-window-highlight" href={`/invoices/${entry.id}`}>
                  <span className="min-w-0">
                    <span className="font-mono font-semibold text-primary">{entry.number}</span>{" "}
                    <span className="truncate">{entry.customerName}</span>
                    <span className="block text-muted-foreground">Vencida hace {dayCount(entry.daysOverdue)}</span>
                  </span>
                  <span className="font-mono font-bold tabular-nums">{money(entry.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {finance.receivables.overdueCount > finance.receivables.overdueInvoices.length ? (
            <Link className="inline-flex items-center gap-1 font-mono text-xs font-bold text-primary hover:underline" href="/invoices?due=overdue">
              Ver las {finance.receivables.overdueCount} vencidas <ArrowRight aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {finance.payables.dueSoon.length > 0 ? (
        <div className="space-y-1.5 border border-window-shadow p-2.5">
          <h3 className="flex items-center gap-1.5 font-mono text-xs font-bold">
            <Receipt aria-hidden="true" className="size-4 text-primary" />
            Paga {finance.payables.dueSoonCount} {finance.payables.dueSoonCount === 1 ? "factura de proveedor" : "facturas de proveedor"} esta semana ({money(finance.payables.dueSoonAmount)})
          </h3>
          <ul className="divide-y divide-window-shadow">
            {finance.payables.dueSoon.map((entry) => (
              <li key={entry.id}>
                <Link className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-window-highlight" href={`/expenses/${entry.id}`}>
                  <span className="min-w-0">
                    <span className="font-mono font-semibold text-primary">{entry.number}</span> <span className="truncate">{entry.supplierName}</span>
                    <span className="block text-muted-foreground">
                      {entry.daysOverdue > 0 ? `Vencida hace ${dayCount(entry.daysOverdue)}` : entry.dueDate ? `Vence el ${formatDate(entry.dueDate)}` : "Sin vencimiento"}
                    </span>
                  </span>
                  <span className="font-mono font-bold tabular-nums">{money(entry.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {finance.unreconciledMovements > 0 ? (
        <Link className="flex items-start justify-between gap-2 border border-window-shadow p-2.5 hover:bg-window-highlight" href="/treasury/reconciliation">
          <span>
            <span className="flex items-center gap-1.5 font-mono text-xs font-bold">
              <Bank aria-hidden="true" className="size-4 text-primary" />
              Concilia {finance.unreconciledMovements} {finance.unreconciledMovements === 1 ? "movimiento bancario" : "movimientos bancarios"}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Relaciónalos con cobros y pagos para que el saldo y las cuentas cuadren.</span>
          </span>
          <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        </Link>
      ) : null}

      {finance.fiscalDeadlines.length > 0 ? (
        <div className="space-y-1.5 border border-window-shadow p-2.5">
          <h3 className="flex items-center gap-1.5 font-mono text-xs font-bold">
            <CalendarCheck aria-hidden="true" className="size-4 text-primary" />
            Plazos fiscales próximos
          </h3>
          <ul className="divide-y divide-window-shadow">
            {finance.fiscalDeadlines.map((deadline) => (
              <li key={`${deadline.code}-${deadline.period}`}>
                <Link className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-window-highlight" href="/fiscal/calendar">
                  <span>
                    <span className="font-mono font-semibold">Modelo {deadline.code}</span> · {deadline.name} · {deadline.periodLabel}
                    <span className={cn("block", deadline.status === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {deadline.status === "overdue"
                        ? `Venció el ${formatDate(deadline.dueDate)} y no consta presentado`
                        : deadline.daysUntil === 0
                          ? "Vence hoy"
                          : `Vence el ${formatDate(deadline.dueDate)} (en ${dayCount(deadline.daysUntil)})`}
                    </span>
                  </span>
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {finance.fiscalDeadlines.length === 0 && finance.nextFiscalDeadline ? (
        <Link
          className="flex items-start justify-between gap-2 border border-window-shadow p-2.5 hover:bg-window-highlight"
          data-testid="dashboard-next-fiscal-deadline"
          href="/fiscal/calendar"
        >
          <span>
            <span className="flex items-center gap-1.5 font-mono text-xs font-bold">
              <CalendarCheck aria-hidden="true" className="size-4 text-primary" />
              Próximo plazo fiscal: modelo {finance.nextFiscalDeadline.code} del {finance.nextFiscalDeadline.periodLabel}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {finance.nextFiscalDeadline.name}. Vence el {formatDate(finance.nextFiscalDeadline.dueDate)} (en {dayCount(Math.max(0, finance.nextFiscalDeadline.daysUntil))}). Abre el calendario fiscal para ver todos tus plazos.
            </span>
          </span>
          <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        </Link>
      ) : null}
    </PageSection>
  );
}
