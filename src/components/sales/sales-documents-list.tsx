"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import {
  salesDocumentStatusLabels,
  salesDocumentStatusTone,
  statusLabel,
} from "@/lib/status-labels";

export type SalesDocumentListRow = {
  id: string;
  number: string;
  customerName: string;
  date: Date | string;
  status: string;
  totalAmount?: string;
  originLabel?: string | null;
};

type SalesDocumentsListProps = {
  basePath: string;
  currencyCode: string;
  dateLabel: string;
  emptyDescription: string;
  emptyTitle: string;
  rows: SalesDocumentListRow[];
  testId: string;
  title: string;
};

export function SalesDocumentsList({
  basePath,
  currencyCode,
  dateLabel,
  emptyDescription,
  emptyTitle,
  rows,
  testId,
  title,
}: SalesDocumentsListProps) {
  const hasAmounts = rows.some((row) => row.totalAmount !== undefined);
  const hasOrigins = rows.some((row) => row.originLabel);
  const columns: ResourceListColumn<SalesDocumentListRow>[] = [
    {
      header: "Documento",
      cell: (row) => (
        <div>
          <Link
            className="font-mono font-semibold text-primary hover:underline"
            href={`${basePath}/${row.id}`}
          >
            {row.number}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.customerName}
          </p>
        </div>
      ),
      exportValue: (row) => row.number,
      sortValue: (row) => row.number,
    },
    {
      header: dateLabel,
      cell: (row) => formatDate(row.date),
      exportValue: (row) => formatDate(row.date),
      sortValue: (row) => new Date(row.date),
    },
    ...(hasOrigins
      ? [
          {
            header: "Origen",
            cell: (row: SalesDocumentListRow) =>
              row.originLabel ?? "Creación directa",
            exportValue: (row: SalesDocumentListRow) =>
              row.originLabel ?? "Creación directa",
            sortValue: (row: SalesDocumentListRow) => row.originLabel ?? "",
          },
        ]
      : []),
    ...(hasAmounts
      ? [
          {
            header: "Importe",
            cell: (row: SalesDocumentListRow) => (
              <span className="font-mono font-semibold">
                {formatMoney(row.totalAmount ?? 0, currencyCode)}
              </span>
            ),
            exportValue: (row: SalesDocumentListRow) => row.totalAmount ?? "0",
            sortValue: (row: SalesDocumentListRow) =>
              Number(row.totalAmount ?? 0),
            className: "text-right",
          },
        ]
      : []),
    {
      header: "Estado",
      cell: (row) => (
        <StatusBadge tone={salesDocumentStatusTone(row.status)}>
          {statusLabel(salesDocumentStatusLabels, row.status)}
        </StatusBadge>
      ),
      exportValue: (row) => statusLabel(salesDocumentStatusLabels, row.status),
      sortValue: (row) => row.status,
    },
    {
      header: "Acciones",
      cell: (row) => (
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`${basePath}/${row.id}`}
        >
          Ver detalle
        </Link>
      ),
      className: "text-right",
    },
  ];

  return (
    <ResourceList
      columns={columns}
      emptyDescription={emptyDescription}
      emptyTitle={emptyTitle}
      exportFileName={`${testId}.csv`}
      getRowId={(row) => row.id}
      getRowTestId={(row) => `${testId}-row-${row.id}`}
      getSearchText={(row) =>
        [
          row.number,
          row.customerName,
          row.status,
          statusLabel(salesDocumentStatusLabels, row.status),
          row.originLabel ?? "",
          formatDate(row.date),
        ].join(" ")
      }
      items={rows}
      renderMobileCard={(row) => (
        <article className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                className="font-mono font-semibold text-primary hover:underline"
                href={`${basePath}/${row.id}`}
              >
                {row.number}
              </Link>
              <p className="truncate text-sm text-muted-foreground">
                {row.customerName}
              </p>
            </div>
            <StatusBadge tone={salesDocumentStatusTone(row.status)}>
              {statusLabel(salesDocumentStatusLabels, row.status)}
            </StatusBadge>
          </div>
          <div className="flex items-end justify-between gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">{dateLabel}</p>
              <p>{formatDate(row.date)}</p>
              {row.originLabel ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.originLabel}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              {row.totalAmount !== undefined ? (
                <p className="font-mono font-semibold">
                  {formatMoney(row.totalAmount, currencyCode)}
                </p>
              ) : null}
              <Link
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={`${basePath}/${row.id}`}
              >
                Ver detalle
              </Link>
            </div>
          </div>
        </article>
      )}
      searchPlaceholder={`Buscar en ${title.toLocaleLowerCase()}`}
      testId={testId}
      title={title}
      filters={[
        {
          key: "status",
          label: "Estado",
          allLabel: "Todos los estados",
          options: Object.entries(salesDocumentStatusLabels).map(
            ([value, label]) => ({ value, label }),
          ),
          getValue: (row) => row.status,
        },
      ]}
    />
  );
}
