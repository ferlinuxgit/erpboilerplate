"use client";

import { BankAccountRowActions } from "@/components/treasury/bank-account-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";

type BankAccountRow = {
  id: string;
  bankName: string;
  iban: string;
};

type BankAccountsListProps = {
  canManage?: boolean;
  rows: BankAccountRow[];
};

const columns = (canManage: boolean): ResourceListColumn<BankAccountRow>[] => [
  {
    header: "Banco",
    cell: (account) => <span className="font-medium">{account.bankName}</span>,
    exportValue: (account) => account.bankName,
    sortValue: (account) => account.bankName,
  },
  {
    header: "IBAN",
    cell: (account) => account.iban,
    exportValue: (account) => account.iban,
    sortValue: (account) => account.iban,
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (account: BankAccountRow) => <BankAccountRowActions id={account.id} />,
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
      getSearchText={(account) => [account.bankName, account.iban].join(" ")}
      items={rows}
      searchPlaceholder="Buscar cuenta por banco o IBAN"
      testId="bank-accounts-list"
      title="Cuentas bancarias"
    />
  );
}
