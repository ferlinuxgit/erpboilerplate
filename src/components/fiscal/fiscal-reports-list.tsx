"use client";

import Link from "next/link";

import { FiscalReportRowActions } from "@/components/fiscal/fiscal-report-row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { fiscalStatusLabels } from "@/lib/fiscal-spain";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { FiscalReportWithSummary } from "@/server/fiscal/service";

type FiscalReportsListProps = {
  reports: FiscalReportWithSummary[];
  canWrite: boolean;
};

const statusTone = {
  DRAFT: "neutral",
  READY: "warning",
  FILED: "success",
} as const;

const dueTone = {
  upcoming: "info",
  "due-soon": "warning",
  overdue: "danger",
} as const;

export function FiscalReportsList({ canWrite, reports }: FiscalReportsListProps) {
  function dueLabel(daysUntilDue: number | null) {
    if (daysUntilDue === null) return "";
    return daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} días vencido` : `${daysUntilDue} días`;
  }

  function renderModelName(report: FiscalReportWithSummary) {
    const content = (
      <>
        {report.summary?.modelName ?? report.code}
      </>
    );

    return canWrite ? (
      <Link className="font-medium hover:underline" href={`/fiscal/${report.id}/edit`}>
        {content}
      </Link>
    ) : (
      <span className="font-medium">{content}</span>
    );
  }

  const columns: ResourceListColumn<FiscalReportWithSummary>[] = [
    {
      header: "Modelo",
      cell: (report) => (
        <div>
          {renderModelName(report)}
          <p className="text-xs text-muted-foreground">{report.summary?.periodLabel ?? report.period}</p>
        </div>
      ),
      exportValue: (report) => report.code,
      sortValue: (report) => report.code,
    },
    {
      header: "Estado",
      cell: (report) => <StatusBadge tone={statusTone[report.status]}>{fiscalStatusLabels[report.status]}</StatusBadge>,
      exportValue: (report) => fiscalStatusLabels[report.status],
      sortValue: (report) => report.status,
    },
    {
      header: "Facturas",
      cell: (report) => `${report.summary?.salesInvoiceCount ?? 0} / ${report.summary?.supplierInvoiceCount ?? 0}`,
      exportValue: (report) => `${report.summary?.salesInvoiceCount ?? 0}/${report.summary?.supplierInvoiceCount ?? 0}`,
      sortValue: (report) => (report.summary?.salesInvoiceCount ?? 0) + (report.summary?.supplierInvoiceCount ?? 0),
    },
    {
      header: "IVA repercutido",
      cell: (report) => formatMoney(report.summary?.outputTaxAmount ?? 0),
      exportValue: (report) => report.summary?.outputTaxAmount ?? 0,
      sortValue: (report) => report.summary?.outputTaxAmount ?? 0,
    },
    {
      header: "A ingresar",
      cell: (report) => <span className="font-medium">{formatMoney(report.summary?.settlementAmount ?? 0)}</span>,
      exportValue: (report) => report.summary?.settlementAmount ?? 0,
      sortValue: (report) => report.summary?.settlementAmount ?? 0,
    },
    {
      header: "Retenciones",
      cell: (report) => formatMoney(report.summary?.withholdingAmount ?? 0),
      exportValue: (report) => report.summary?.withholdingAmount ?? 0,
      sortValue: (report) => report.summary?.withholdingAmount ?? 0,
    },
    {
      header: "Vencimiento",
      cell: (report) => report.summary?.dueDate ? (
        <div className="space-y-1">
          <span>{formatDate(report.summary.dueDate)}</span>
          {report.summary.dueStatus ? <StatusBadge tone={dueTone[report.summary.dueStatus]}>{dueLabel(report.summary.daysUntilDue)}</StatusBadge> : null}
        </div>
      ) : "Sin fecha",
      exportValue: (report) => report.summary?.dueDate ? formatDate(report.summary.dueDate) : "",
      sortValue: (report) => report.summary?.dueDate ? new Date(report.summary.dueDate) : null,
    },
    {
      header: "Actualizado",
      cell: (report) => formatDateTime(report.updatedAt),
      exportValue: (report) => formatDateTime(report.updatedAt),
      sortValue: (report) => report.updatedAt,
    },
    {
      header: "Acciones",
      cell: (report) => (canWrite ? <FiscalReportRowActions id={report.id} /> : null),
      className: "text-right",
    },
  ];

  return (
    <ResourceList
      columns={columns}
      emptyDescription="Crea el primer borrador fiscal español para controlar IVA, resúmenes anuales y obligaciones informativas."
      emptyTitle="Sin modelos fiscales"
      exportFileName="fiscalidad-espana.csv"
      getRowId={(report) => report.id}
      getSearchText={(report) => `${report.code} ${report.period} ${report.status} ${fiscalStatusLabels[report.status]} ${report.summary?.modelName ?? ""}`}
      items={reports}
      renderMobileCard={(report) => (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              {renderModelName(report)}
              <p className="text-sm text-muted-foreground">{report.summary?.periodLabel ?? report.period}</p>
            </div>
            <StatusBadge tone={statusTone[report.status]}>{fiscalStatusLabels[report.status]}</StatusBadge>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">IVA repercutido</dt>
              <dd className="font-medium">{formatMoney(report.summary?.outputTaxAmount ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">A ingresar</dt>
              <dd className="font-medium">{formatMoney(report.summary?.settlementAmount ?? 0)}</dd>
            </div>
          </dl>
          {canWrite ? <FiscalReportRowActions id={report.id} /> : null}
        </div>
      )}
      searchPlaceholder="Buscar modelo, periodo o estado"
      testId="fiscal-reports-list"
      title="Modelos fiscales"
    />
  );
}
