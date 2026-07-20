"use client";

import Link from "next/link";

import { BankTransactionRowActions } from "@/components/treasury/bank-transaction-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { reconciliationStatusLabels, statusLabel } from "@/lib/status-labels";

type BankTransactionRow = {
  id: string;
  bankAccountId: string;
  bankName: string;
  iban: string;
  amount: string;
  description: string;
  postedAt: Date | string;
  reconciliationStatus: string;
};

type BankTransactionsListProps = {
  accounts: { id: string; bankName: string; iban: string }[];
  canManage?: boolean;
  currencyCode: string;
  rows: BankTransactionRow[];
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
  },
  {
    header: "Importe",
    cell: (row) => formatMoney(row.amount, currencyCode),
    exportValue: (row) => formatMoney(row.amount, currencyCode),
    sortValue: (row) => Number(row.amount),
  },
  {
    header: "Fecha",
    cell: (row) => formatDate(row.postedAt),
    exportValue: (row) => formatDate(row.postedAt),
    sortValue: (row) => new Date(row.postedAt),
  },
  {
    header: "Conciliación",
    cell: (row) => (
      <StatusBadge
        tone={row.reconciliationStatus === "RECONCILED" ? "success" : "warning"}
      >
        {statusLabel(reconciliationStatusLabels, row.reconciliationStatus)}
      </StatusBadge>
    ),
    exportValue: (row) =>
      statusLabel(reconciliationStatusLabels, row.reconciliationStatus),
    sortValue: (row) => row.reconciliationStatus,
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
  rows,
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
          statusLabel(reconciliationStatusLabels, row.reconciliationStatus),
          formatDate(row.postedAt),
        ].join(" ")
      }
      items={rows}
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
            <StatusBadge
              className="mt-2"
              tone={
                row.reconciliationStatus === "RECONCILED"
                  ? "success"
                  : "warning"
              }
            >
              {statusLabel(
                reconciliationStatusLabels,
                row.reconciliationStatus,
              )}
            </StatusBadge>
          </div>
          {canManage ? <BankTransactionRowActions currencyCode={currencyCode} transaction={row} /> : null}
        </div>
      )}
      searchPlaceholder="Buscar movimiento por banco, concepto, importe o estado"
      testId="bank-transactions-list"
      title="Movimientos"
      filters={[
        {
          key: "account",
          label: "Cuenta bancaria",
          allLabel: "Todas las cuentas",
          options: accounts.map((account) => ({
            value: account.id,
            label: account.bankName,
          })),
          getValue: (row) => row.bankAccountId,
        },
        {
          key: "reconciliation",
          label: "Conciliación",
          allLabel: "Todos los estados",
          options: Object.entries(reconciliationStatusLabels).map(
            ([value, label]) => ({ value, label }),
          ),
          getValue: (row) => row.reconciliationStatus,
        },
      ]}
    />
  );
}
