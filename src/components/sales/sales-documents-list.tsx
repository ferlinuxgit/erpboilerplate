"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  ResourceList,
  type ResourceListColumn,
  type ServerListState,
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
  /**
   * Server pagination state; `rows` is then only the current page. Server sort keys:
   * "number", "date", "origin", "total", "status" (the page whitelists the ones it supports).
   */
  server?: ServerListState;
  /** Footer totals over every filtered document (server mode). */
  totals?: { totalAmount: number };
  /** Show the amount column (defaults to "some row has an amount"; set it in server mode). */
  showAmounts?: boolean;
  /** Show the origin column (defaults to "some row has an origin"; set it in server mode). */
  showOrigin?: boolean;
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
  server,
  totals,
  showAmounts,
  showOrigin,
}: SalesDocumentsListProps) {
  // In server mode `rows` is one page (possibly empty): columns must not depend on it.
  const hasAmounts = showAmounts ?? rows.some((row) => row.totalAmount !== undefined);
  const hasOrigins = showOrigin ?? rows.some((row) => row.originLabel);
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
      sortKey: "number",
    },
    {
      header: dateLabel,
      cell: (row) => formatDate(row.date),
      exportValue: (row) => formatDate(row.date),
      sortValue: (row) => new Date(row.date),
      sortKey: "date",
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
            sortKey: "origin",
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
            exportValue: (row: SalesDocumentListRow) => Number(row.totalAmount ?? 0),
            summary: (filtered: SalesDocumentListRow[]) =>
              formatMoney(
                totals
                  ? totals.totalAmount
                  : filtered.reduce((total, row) => total + Math.round(Number(row.totalAmount ?? 0) * 100), 0) / 100,
                currencyCode,
              ),
            sortValue: (row: SalesDocumentListRow) =>
              Number(row.totalAmount ?? 0),
            sortKey: "total",
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
      sortKey: "status",
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
      getRowLabel={(row) => row.number}
      dateRange={{ label: dateLabel, getValue: (row) => row.date }}
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
      server={server}
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
