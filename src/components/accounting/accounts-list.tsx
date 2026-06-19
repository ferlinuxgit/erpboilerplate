"use client";

import Link from "next/link";

import { AccountRowActions } from "@/components/accounting/account-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { accountTypeLabels, statusLabel } from "@/lib/status-labels";
import { formatMoney } from "@/lib/format";

type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  level: number;
  isPostable: boolean;
  isActive: boolean;
  debit: number;
  credit: number;
  balance: number;
};

type AccountsListProps = {
  canManage: boolean;
  rows: AccountRow[];
};

export function AccountsList({ canManage, rows }: AccountsListProps) {
  const columns: ResourceListColumn<AccountRow>[] = [
    {
      header: "Cuenta",
      cell: (account) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{account.code} - {account.name}</p>
          <Link className="text-sm text-primary underline-offset-4 hover:underline" href={`/accounting/ledger/${account.id}`}>
            Ver mayor
          </Link>
        </div>
      ),
      exportValue: (account) => `${account.code} - ${account.name}`,
      sortValue: (account) => account.code,
    },
    {
      header: "Tipo",
      cell: (account) => statusLabel(accountTypeLabels, account.type),
      exportValue: (account) => statusLabel(accountTypeLabels, account.type),
      sortValue: (account) => account.type,
    },
    {
      header: "Uso",
      cell: (account) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge tone={account.isPostable ? "success" : "neutral"}>{account.isPostable ? "Postable" : `Nivel ${account.level}`}</StatusBadge>
          <StatusBadge tone={account.isActive ? "success" : "neutral"}>{account.isActive ? "Activa" : "Inactiva"}</StatusBadge>
        </div>
      ),
      exportValue: (account) => `${account.isPostable ? "Postable" : "No postable"} / ${account.isActive ? "Activa" : "Inactiva"}`,
      sortValue: (account) => `${account.isActive ? "0" : "1"}-${account.isPostable ? "0" : "1"}-${account.code}`,
    },
    {
      header: "Saldo",
      className: "text-right",
      cell: (account) => formatMoney(account.balance),
      exportValue: (account) => account.balance,
      sortValue: (account) => account.balance,
    },
    {
      header: "Acciones",
      className: "text-right",
      cell: (account) => canManage ? <AccountRowActions id={account.id} /> : null,
    },
  ];

  return (
    <ResourceList
      columns={columns}
      emptyDescription="Carga la plantilla contable para crear el plan general."
      emptyTitle="Plan contable vacío"
      exportFileName="plan-contable.csv"
      getRowId={(account) => account.id}
      getSearchText={(account) => `${account.code} ${account.name} ${account.type} ${account.isActive ? "activa" : "inactiva"} ${account.isPostable ? "postable" : "grupo"}`}
      items={rows}
      pageSize={16}
      pageSizeOptions={[16, 32, 64, 128]}
      renderMobileCard={(account) => (
        <div className="space-y-2">
          <div>
            <p className="font-medium">{account.code} - {account.name}</p>
            <p className="text-sm text-muted-foreground">{statusLabel(accountTypeLabels, account.type)} · Saldo {formatMoney(account.balance)}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <StatusBadge tone={account.isPostable ? "success" : "neutral"}>{account.isPostable ? "Postable" : `Nivel ${account.level}`}</StatusBadge>
            <StatusBadge tone={account.isActive ? "success" : "neutral"}>{account.isActive ? "Activa" : "Inactiva"}</StatusBadge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="text-sm text-primary underline-offset-4 hover:underline" href={`/accounting/ledger/${account.id}`}>
              Ver mayor
            </Link>
            {canManage ? <AccountRowActions id={account.id} /> : null}
          </div>
        </div>
      )}
      searchPlaceholder="Buscar código, nombre, tipo, activa, postable..."
      testId="account-chart-list"
      title="Plan general contable"
    />
  );
}
