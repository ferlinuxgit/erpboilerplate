"use client";

import Link from "next/link";

import { RecurringStatusActions } from "@/components/recurring/recurring-status-actions";
import { buttonVariants } from "@/components/ui/button";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { issueModeLabels, expenseIssueModeLabels, type RecurringIssueMode } from "@/server/recurring/schemas";
import { describeSchedule, formatScheduleDate } from "@/server/recurring/schedule";

export type RecurringTemplateRow = {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "FINISHED";
  partyName: string;
  intervalMonths: number;
  dayOfMonth: number;
  issueMode: RecurringIssueMode;
  nextRunDate: string | null;
  upcoming: string[];
  occurrencesGenerated: number;
  estimatedTotal: number;
  lastError: string | null;
  pendingReviewCount: number;
};

const statusLabels = { ACTIVE: "Activa", PAUSED: "En pausa", FINISHED: "Terminada" } as const;
const statusTones = { ACTIVE: "success", PAUSED: "warning", FINISHED: "neutral" } as const;

/** Listado de facturas o gastos recurrentes con próxima fecha, vista previa y pausa/reanudación. */
export function RecurringTemplatesList({
  basePath,
  canEdit,
  currencyCode = "EUR",
  kind,
  rows,
}: {
  rows: RecurringTemplateRow[];
  kind: "SALES_INVOICE" | "EXPENSE";
  basePath: string;
  canEdit: boolean;
  currencyCode?: string;
}) {
  const modeLabel = (mode: RecurringIssueMode) => (kind === "EXPENSE" && (mode === "DRAFT" || mode === "POST") ? expenseIssueModeLabels[mode] : issueModeLabels[mode]);
  const columns: ResourceListColumn<RecurringTemplateRow>[] = [
    {
      header: "Nombre",
      alwaysVisible: true,
      cell: (row) => (
        <span>
          <Link className="font-semibold text-primary hover:underline" href={`${basePath}/${row.id}`}>{row.name}</Link>
          {row.lastError ? <span className="block text-xs text-destructive">Error: {row.lastError}</span> : null}
          {row.pendingReviewCount > 0 ? <span className="block text-xs text-warning-text">{row.pendingReviewCount} pendiente(s) de revisar</span> : null}
        </span>
      ),
      exportValue: (row) => row.name,
      sortValue: (row) => row.name,
    },
    { header: kind === "EXPENSE" ? "Proveedor" : "Cliente", cell: (row) => row.partyName, exportValue: (row) => row.partyName, sortValue: (row) => row.partyName },
    { header: "Periodicidad", cell: (row) => describeSchedule(row), exportValue: (row) => describeSchedule(row) },
    {
      header: "Próxima",
      cell: (row) => (row.nextRunDate ? (
        <span title={row.upcoming.length > 1 ? `Siguientes: ${row.upcoming.slice(1).map(formatScheduleDate).join(", ")}` : undefined}>
          {formatScheduleDate(row.nextRunDate)}
        </span>
      ) : "—"),
      exportValue: (row) => row.nextRunDate ?? "",
      sortValue: (row) => row.nextRunDate,
    },
    { header: "Qué hace", cell: (row) => modeLabel(row.issueMode), exportValue: (row) => modeLabel(row.issueMode) },
    {
      header: "Importe",
      className: "text-right font-mono tabular-nums",
      cell: (row) => formatMoney(row.estimatedTotal, currencyCode),
      exportValue: (row) => row.estimatedTotal,
      sortValue: (row) => row.estimatedTotal,
    },
    { header: "Generadas", className: "text-right", cell: (row) => row.occurrencesGenerated, exportValue: (row) => row.occurrencesGenerated, sortValue: (row) => row.occurrencesGenerated },
    {
      header: "Estado",
      cell: (row) => <StatusBadge tone={statusTones[row.status]}>{statusLabels[row.status]}</StatusBadge>,
      exportValue: (row) => statusLabels[row.status],
      sortValue: (row) => row.status,
    },
    {
      header: "Acciones",
      className: "text-right",
      cell: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`${basePath}/${row.id}`}>Ver</Link>
          {canEdit ? <RecurringStatusActions id={row.id} name={row.name} size="sm" status={row.status} /> : null}
        </div>
      ),
    },
  ];

  return (
    <ResourceList
      columns={columns}
      createAction={canEdit ? { label: kind === "EXPENSE" ? "Nuevo gasto recurrente" : "Nueva factura recurrente", href: `${basePath}/new` } : undefined}
      emptyDescription={kind === "EXPENSE"
        ? "Alquiler, cuotas, suscripciones o la cuota de autónomos: créalo una vez y se prepara solo cada periodo."
        : "Crea una desde cero o abre una factura y pulsa «Hacer recurrente»."}
      emptyTitle={kind === "EXPENSE" ? "Todavía no hay gastos recurrentes." : "Todavía no hay facturas recurrentes."}
      enableSelection={false}
      exportFileName={kind === "EXPENSE" ? "gastos-recurrentes.csv" : "facturas-recurrentes.csv"}
      filters={[{
        key: "status",
        label: "Estado",
        allLabel: "Todos",
        options: [{ value: "ACTIVE", label: "Activas" }, { value: "PAUSED", label: "En pausa" }, { value: "FINISHED", label: "Terminadas" }],
        getValue: (row) => row.status,
      }]}
      getRowId={(row) => row.id}
      getRowLabel={(row) => row.name}
      getSearchText={(row) => [row.name, row.partyName].join(" ")}
      items={rows}
      renderMobileCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Link className="font-semibold text-primary hover:underline" href={`${basePath}/${row.id}`}>{row.name}</Link>
            <StatusBadge tone={statusTones[row.status]}>{statusLabels[row.status]}</StatusBadge>
          </div>
          <p className="text-xs text-muted-foreground">{row.partyName} · {describeSchedule(row)}</p>
          <p className="text-xs">Próxima: {row.nextRunDate ? formatScheduleDate(row.nextRunDate) : "—"} · {formatMoney(row.estimatedTotal, currencyCode)}</p>
          {canEdit ? <RecurringStatusActions id={row.id} name={row.name} size="sm" status={row.status} /> : null}
        </div>
      )}
      searchPlaceholder="Buscar por nombre o por cliente/proveedor"
      testId={kind === "EXPENSE" ? "recurring-expenses-list" : "recurring-invoices-list"}
      title={kind === "EXPENSE" ? "Gastos recurrentes" : "Facturas recurrentes"}
    />
  );
}
