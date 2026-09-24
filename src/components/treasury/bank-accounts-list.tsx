"use client";

import Link from "next/link";

import { BankAccountRowActions } from "@/components/treasury/bank-account-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";

type BankAccountRow = {
  id: string;
  bankName: string;
  iban: string;
  accountCode?: string | null;
  accountName?: string | null;
  isActive?: boolean;
};

type BankAccountsListProps = {
  canManage?: boolean;
  rows: BankAccountRow[];
};

function ledgerLabel(account: BankAccountRow) {
  return account.accountCode ? `${account.accountCode} · ${account.accountName ?? ""}` : "572 (por defecto)";
}

const columns = (canManage: boolean): ResourceListColumn<BankAccountRow>[] => [
  {
    header: "Banco",
    cell: (account) => <Link className="font-medium text-primary hover:underline" href={`/treasury/bank-accounts/${account.id}`}>{account.bankName}</Link>,
    exportValue: (account) => account.bankName,
    sortValue: (account) => account.bankName,
  },
  {
    header: "IBAN",
    cell: (account) => account.iban,
    exportValue: (account) => account.iban,
    sortValue: (account) => account.iban,
  },
  {
    header: "Cuenta contable",
    cell: (account) => <span className="text-sm">{ledgerLabel(account)}</span>,
    exportValue: (account) => ledgerLabel(account),
    sortValue: (account) => account.accountCode ?? "572",
  },
  {
    header: "Estado",
    cell: (account) => <StatusBadge tone={account.isActive === false ? "neutral" : "success"}>{account.isActive === false ? "Archivada" : "Activa"}</StatusBadge>,
    exportValue: (account) => (account.isActive === false ? "Archivada" : "Activa"),
    sortValue: (account) => (account.isActive === false ? 1 : 0),
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (account: BankAccountRow) => <BankAccountRowActions account={account} />,
          className: "text-right",
        },
      ]
    : []),
];

export function BankAccountsList({ canManage = true, rows }: BankAccountsListProps) {
  return (
    <ResourceList
      columns={columns(canManage)}
      emptyDescription="Añade una cuenta bancaria para registrar movimientos y conciliaciones."
      emptyTitle="Sin cuentas bancarias."
      exportFileName="cuentas-bancarias.csv"
      getRowId={(account) => account.id}
      getSearchText={(account) => [account.bankName, account.iban, account.accountCode ?? ""].join(" ")}
      items={rows}
      renderMobileCard={(account) => (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <Link className="font-medium text-primary hover:underline" href={`/treasury/bank-accounts/${account.id}`}>{account.bankName}</Link>
              <StatusBadge tone={account.isActive === false ? "neutral" : "success"}>{account.isActive === false ? "Archivada" : "Activa"}</StatusBadge>
            </div>
            <p className="break-all text-sm text-muted-foreground">{account.iban}</p>
            <p className="text-xs text-muted-foreground">Cuenta contable: {ledgerLabel(account)}</p>
          </div>
          {canManage ? <BankAccountRowActions account={account} /> : null}
        </div>
      )}
      searchPlaceholder="Buscar cuenta por banco, IBAN o cuenta contable"
      testId="bank-accounts-list"
      title="Cuentas bancarias"
    />
  );
}
