"use client";

import Link from "next/link";

import { BankTransactionRowActions } from "@/components/treasury/bank-transaction-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
  type ServerListState,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { movementStatusDescriptions, movementStatusKey, movementStatusLabels, movementStatusTone } from "@/components/treasury/movement-status";

type BankTransactionRow = {
  id: string;
  bankAccountId: string;
  bankName: string;
  iban: string;
  amount: string;
  description: string;
  postedAt: Date | string;
  reconciliationStatus: string;
  resolution?: string | null;
  reference?: string | null;
};

function statusOf(row: BankTransactionRow) {
  return movementStatusKey(row.reconciliationStatus, row.resolution);
}

function MovementStatusBadge({ row, className }: { row: BankTransactionRow; className?: string }) {
  const key = statusOf(row);
  return (
    <span title={movementStatusDescriptions[key]}>
      <StatusBadge className={className} tone={movementStatusTone(key)}>{movementStatusLabels[key]}</StatusBadge>
    </span>
  );
}

type BankTransactionsListProps = {
  accounts: { id: string; bankName: string; iban: string }[];
  canManage?: boolean;
  currencyCode: string;
  rows: BankTransactionRow[];
  /** Server pagination state; `rows` is then only the current page. */
  server?: ServerListState;
  /** Filters fixed by the page (e.g. reconciliation only lists pending movements): not shown. */
  hiddenFilters?: Array<"account" | "reconciliation">;
};

const columns = (
  currencyCode: string,
  canManage: boolean,
): ResourceListColumn<BankTransactionRow>[] => [
  {
    header: "Movimiento",
    cell: (row) => (
      <div>
        <Link
          className="font-medium text-primary hover:underline"
          href={`/treasury/bank-transactions/${row.id}`}
        >
          {row.description}
        </Link>
        <p className="text-sm text-muted-foreground">{row.bankName}</p>
      </div>
    ),
    exportValue: (row) => row.description,
    sortValue: (row) => row.description,
    sortKey: "description",
  },
  {
    header: "Importe",
    className: "text-right tabular-nums",
    cell: (row) => formatMoney(row.amount, currencyCode),
    exportValue: (row) => Number(row.amount),
    sortValue: (row) => Number(row.amount),
    sortKey: "amount",
  },
  {
    header: "Fecha",
    cell: (row) => formatDate(row.postedAt),
    exportValue: (row) => formatDate(row.postedAt),
    sortValue: (row) => new Date(row.postedAt),
    sortKey: "postedAt",
  },
  {
    header: "Estado",
    cell: (row) => <MovementStatusBadge row={row} />,
    exportValue: (row) => movementStatusLabels[statusOf(row)],
    sortValue: (row) => row.reconciliationStatus,
    sortKey: "status",
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (row: BankTransactionRow) => (
            <BankTransactionRowActions currencyCode={currencyCode} transaction={row} />
          ),
          className: "text-right",
        },
      ]
    : []),
];

export function BankTransactionsList({
  accounts,
  canManage = true,
  currencyCode,
  hiddenFilters,
  rows,
  server,
}: BankTransactionsListProps) {
  return (
    <ResourceList
      columns={columns(currencyCode, canManage)}
      emptyDescription="Registra movimientos bancarios para controlar cobros, pagos y conciliación."
      emptyTitle="Sin movimientos bancarios."
      exportFileName="movimientos-bancarios.csv"
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        [
          row.bankName,
          row.iban,
          row.description,
          row.amount,
          row.reconciliationStatus,
          movementStatusLabels[statusOf(row)],
          formatDate(row.postedAt),
        ].join(" ")
      }
      items={rows}
      server={server}
      dateRange={{ label: "Fecha", getValue: (row) => row.postedAt }}
      renderMobileCard={(row) => (
        <div className="space-y-3">
          <div>
            <Link
              className="font-medium text-primary hover:underline"
              href={`/treasury/bank-transactions/${row.id}`}
            >
              {row.description}
            </Link>
            <p className="text-sm text-muted-foreground">{row.bankName}</p>
            <p className="text-sm text-muted-foreground">
              {formatDate(row.postedAt)} ·{" "}
              {formatMoney(row.amount, currencyCode)}
            </p>
            <MovementStatusBadge className="mt-2" row={row} />
          </div>
          {canManage ? <BankTransactionRowActions currencyCode={currencyCode} transaction={row} /> : null}
        </div>
      )}
      searchPlaceholder="Buscar movimiento por banco, concepto, importe o estado"
      testId="bank-transactions-list"
      title="Movimientos"
      filters={[
        {
          key: "account" as const,
          label: "Cuenta bancaria",
          allLabel: "Todas las cuentas",
          options: accounts.map((account) => ({
            value: account.id,
            label: account.bankName,
          })),
          getValue: (row: BankTransactionRow) => row.bankAccountId,
        },
        {
          key: "reconciliation" as const,
          label: "Estado",
          allLabel: "Todos los estados",
          options: Object.entries(movementStatusLabels).map(
            ([value, label]) => ({ value, label }),
          ),
          getValue: (row: BankTransactionRow) => statusOf(row),
        },
      ].filter((filter) => !hiddenFilters?.includes(filter.key))}
    />
  );
}
