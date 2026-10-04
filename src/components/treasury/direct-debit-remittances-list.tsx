"use client";

import Link from "next/link";

import { directDebitStatusLabels, directDebitStatusTone } from "@/components/treasury/direct-debit-status";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";

export type DirectDebitRemittanceRow = {
  id: string;
  number: string;
  status: string;
  bankName: string;
  collectionDate: Date | string;
  itemCount: number;
  returned: number;
  totalAmount: string;
};

const statusLabel = (row: DirectDebitRemittanceRow) => directDebitStatusLabels[row.status] ?? row.status;
const returnedLabel = (count: number) => `${count} ${count === 1 ? "devuelto" : "devueltos"}`;

function RemittanceLink({ row }: { row: DirectDebitRemittanceRow }) {
  return <Link className="font-mono font-semibold text-link hover:underline" href={`/treasury/direct-debits/${row.id}`}>{row.number}</Link>;
}

function columns(currency: string): ResourceListColumn<DirectDebitRemittanceRow>[] {
  return [
    {
      header: "Remesa",
      alwaysVisible: true,
      cell: (row) => <RemittanceLink row={row} />,
      exportValue: (row) => row.number,
      sortValue: (row) => row.number,
    },
    {
      header: "Cuenta de abono",
      cell: (row) => row.bankName,
      exportValue: (row) => row.bankName,
      sortValue: (row) => row.bankName,
    },
    {
      header: "Cobro",
      cell: (row) => formatDate(row.collectionDate),
      exportValue: (row) => formatDate(row.collectionDate),
      sortValue: (row) => new Date(row.collectionDate),
    },
    {
      header: "Recibos",
      className: "text-right",
      cell: (row) => (
        <>
          {row.itemCount}
          {row.returned > 0 ? <span className="block text-xs text-danger-text">{returnedLabel(row.returned)}</span> : null}
        </>
      ),
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
      cell: (row) => <StatusBadge tone={directDebitStatusTone(row.status)}>{statusLabel(row)}</StatusBadge>,
      exportValue: statusLabel,
      sortValue: statusLabel,
    },
  ];
}

export function DirectDebitRemittancesList({ currency, rows }: { currency: string; rows: DirectDebitRemittanceRow[] }) {
  return (
    <ResourceList
      columns={columns(currency)}
      emptyDescription="Ninguna remesa coincide con la búsqueda o los filtros."
      emptyTitle="Sin resultados"
      enableSelection={false}
      exportFileName="remesas-cobros.csv"
      filters={[
        {
          key: "status",
          label: "Estado",
          allLabel: "Todos los estados",
          options: Object.entries(directDebitStatusLabels).map(([value, label]) => ({ value, label })),
          getValue: (row) => row.status,
        },
      ]}
      dateRange={{ label: "Fecha de cobro", getValue: (row) => row.collectionDate }}
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
            <StatusBadge tone={directDebitStatusTone(row.status)}>{statusLabel(row)}</StatusBadge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            <dt className="text-muted-foreground">Cobro</dt>
            <dd className="text-right">{formatDate(row.collectionDate)}</dd>
            <dt className="text-muted-foreground">Recibos</dt>
            <dd className="text-right tabular-nums">
              {row.itemCount}
              {row.returned > 0 ? <span className="text-danger-text"> · {returnedLabel(row.returned)}</span> : null}
            </dd>
            <dt className="text-muted-foreground">Total</dt>
            <dd className="text-right font-bold tabular-nums">{formatMoney(row.totalAmount, currency)}</dd>
          </dl>
        </div>
      )}
      searchPlaceholder="Buscar por número, banco o estado"
      summaryLabel="Total"
      testId="direct-debit-remittances-list"
      title="Remesas de cobros"
    />
  );
}
