"use client";

import Link from "next/link";

import { remittanceStatusLabels, remittanceStatusTone } from "@/components/treasury/remittance-status";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";

export type RemittanceRow = {
  id: string;
  number: string;
  status: string;
  bankName: string;
  executionDate: Date | string;
  itemCount: number;
  totalAmount: string;
};

const statusLabel = (row: RemittanceRow) => remittanceStatusLabels[row.status] ?? row.status;

function RemittanceLink({ row }: { row: RemittanceRow }) {
  return <Link className="font-mono font-semibold text-link hover:underline" href={`/treasury/remittances/${row.id}`}>{row.number}</Link>;
}

function columns(currency: string): ResourceListColumn<RemittanceRow>[] {
  return [
    {
      header: "Remesa",
      alwaysVisible: true,
      cell: (row) => <RemittanceLink row={row} />,
      exportValue: (row) => row.number,
      sortValue: (row) => row.number,
    },
    {
      header: "Cuenta de cargo",
      cell: (row) => row.bankName,
      exportValue: (row) => row.bankName,
      sortValue: (row) => row.bankName,
    },
    {
      header: "Ejecución",
      cell: (row) => formatDate(row.executionDate),
      exportValue: (row) => formatDate(row.executionDate),
      sortValue: (row) => new Date(row.executionDate),
    },
    {
      header: "Pagos",
      className: "text-right",
      cell: (row) => row.itemCount,
      exportValue: (row) => row.itemCount,
      sortValue: (row) => row.itemCount,
    },
    {
      header: "Total",
      className: "text-right",
      cell: (row) => formatMoney(row.totalAmount, currency),
      exportValue: (row) => Number(row.totalAmount),
      sortValue: (row) => Number(row.totalAmount),
      summary: (rows) => formatMoney(rows.reduce((total, row) => total + Number(row.totalAmount), 0), currency),
    },
    {
      header: "Estado",
      cell: (row) => <StatusBadge tone={remittanceStatusTone(row.status)}>{statusLabel(row)}</StatusBadge>,
      exportValue: statusLabel,
      sortValue: statusLabel,
    },
  ];
}

export function RemittancesList({ currency, rows }: { currency: string; rows: RemittanceRow[] }) {
  return (
    <ResourceList
      columns={columns(currency)}
      emptyDescription="Ninguna remesa coincide con la búsqueda o los filtros."
      emptyTitle="Sin resultados"
      enableSelection={false}
      exportFileName="remesas-pagos.csv"
      filters={[
        {
          key: "status",
          label: "Estado",
          allLabel: "Todos los estados",
          options: Object.entries(remittanceStatusLabels).map(([value, label]) => ({ value, label })),
          getValue: (row) => row.status,
        },
      ]}
      dateRange={{ label: "Fecha de ejecución", getValue: (row) => row.executionDate }}
      getRowId={(row) => row.id}
      getRowLabel={(row) => `Remesa ${row.number}`}
      getSearchText={(row) => `${row.number} ${row.bankName} ${statusLabel(row)}`}
      items={rows}
      renderMobileCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <RemittanceLink row={row} />
              <p className="truncate text-xs text-muted-foreground">{row.bankName}</p>
            </div>
            <StatusBadge tone={remittanceStatusTone(row.status)}>{statusLabel(row)}</StatusBadge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            <dt className="text-muted-foreground">Ejecución</dt>
            <dd className="text-right">{formatDate(row.executionDate)}</dd>
            <dt className="text-muted-foreground">Pagos</dt>
            <dd className="text-right tabular-nums">{row.itemCount}</dd>
            <dt className="text-muted-foreground">Total</dt>
            <dd className="text-right font-bold tabular-nums">{formatMoney(row.totalAmount, currency)}</dd>
          </dl>
        </div>
      )}
      searchPlaceholder="Buscar por número, banco o estado"
      testId="remittances-list"
      title="Remesas de pagos"
    />
  );
}
