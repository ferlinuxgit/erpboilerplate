"use client";

import { BankTransactionRowActions } from "@/components/treasury/bank-transaction-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { reconciliationStatusLabels, statusLabel } from "@/lib/status-labels";

type BankTransactionRow = {
  id: string;
  bankName: string;
  iban: string;
  amount: string;
  description: string;
  postedAt: Date | string;
  reconciliationStatus: string;
};

type BankTransactionsListProps = {
  canManage?: boolean;
  currencyCode: string;
  rows: BankTransactionRow[];
};

const columns = (currencyCode: string, canManage: boolean): ResourceListColumn<BankTransactionRow>[] => [
  {
    header: "Movimiento",
    cell: (row) => (
      <div>
        <p className="font-medium">{row.description}</p>
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
      <StatusBadge tone={row.reconciliationStatus === "RECONCILED" ? "success" : "warning"}>
        {statusLabel(reconciliationStatusLabels, row.reconciliationStatus)}
      </StatusBadge>
    ),
    exportValue: (row) => statusLabel(reconciliationStatusLabels, row.reconciliationStatus),
    sortValue: (row) => row.reconciliationStatus,
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (row: BankTransactionRow) => <BankTransactionRowActions id={row.id} />,
          className: "text-right",
        },
      ]
    : []),
];

export function BankTransactionsList({ canManage = true, currencyCode, rows }: BankTransactionsListProps) {
  return (
    <ResourceList
      columns={columns(currencyCode, canManage)}
      emptyDescription="Registra movimientos bancarios para controlar cobros, pagos y conciliación."
      emptyTitle="Sin movimientos bancarios."
      exportFileName="movimientos-bancarios.csv"
      getRowId={(row) => row.id}
      getSearchText={(row) => [row.bankName, row.iban, row.description, row.amount, row.reconciliationStatus, statusLabel(reconciliationStatusLabels, row.reconciliationStatus), formatDate(row.postedAt)].join(" ")}
      items={rows}
      renderMobileCard={(row) => (
        <div className="space-y-3">
          <div>
            <p className="font-medium">{row.description}</p>
            <p className="text-sm text-muted-foreground">{row.bankName}</p>
            <p className="text-sm text-muted-foreground">{formatDate(row.postedAt)} · {formatMoney(row.amount, currencyCode)}</p>
            <StatusBadge className="mt-2" tone={row.reconciliationStatus === "RECONCILED" ? "success" : "warning"}>
              {statusLabel(reconciliationStatusLabels, row.reconciliationStatus)}
            </StatusBadge>
          </div>
          <BankTransactionRowActions id={row.id} />
        </div>
      )}
      searchPlaceholder="Buscar movimiento por banco, concepto, importe o estado"
      testId="bank-transactions-list"
      title="Movimientos"
    />
  );
}
