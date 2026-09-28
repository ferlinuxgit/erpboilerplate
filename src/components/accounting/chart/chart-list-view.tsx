"use client";

import { DotsThree } from "@phosphor-icons/react";

import { AccountCode, AmountCell, BalanceCell, BlockedIcon, PartnerBadge } from "@/components/accounting/chart/account-code";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLinkItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { balanceSideWord, ledgerHref } from "@/lib/chart-of-accounts/format";
import type { ChartNode } from "@/lib/chart-of-accounts/types";
import { accountTypeLabels, statusLabel } from "@/lib/status-labels";

type ChartListViewProps = {
  nodes: ChartNode[];
  canManage: boolean;
  range: { from: string; to: string };
  loading: boolean;
  onToggleBlocked: (node: ChartNode) => void;
  onCopyCode: (code: string) => void;
  onOpen: (code: string) => void;
};

/** Menú de acciones de una cuenta (lista y menú contextual del árbol comparten opciones). */
export function AccountActionsMenu({ canManage, node, onCopyCode, onOpen, onToggleBlocked, range }: { node: ChartNode } & Omit<ChartListViewProps, "nodes" | "loading">) {
  return (
    <DropdownMenu label={`Acciones de la cuenta ${node.code}`} trigger={<DotsThree aria-hidden="true" weight="bold" />} triggerSize="icon-sm" triggerVariant="ghost">
      <DropdownMenuItem onClick={() => onOpen(node.code)}>Ver en el árbol</DropdownMenuItem>
      {node.isPostable ? <DropdownMenuLinkItem href={ledgerHref(node.id, range)}>Ver mayor</DropdownMenuLinkItem> : null}
      {canManage ? <DropdownMenuLinkItem href={`/accounting/accounts/${node.id}/edit`}>Editar</DropdownMenuLinkItem> : null}
      {canManage && node.isPostable ? <DropdownMenuItem onClick={() => onToggleBlocked(node)}>{node.isBlocked ? "Desbloquear" : "Bloquear"}</DropdownMenuItem> : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onCopyCode(node.code)}>Copiar código</DropdownMenuItem>
    </DropdownMenu>
  );
}

/** Vista «Lista»: el plan completo ordenable por saldo, con debe/haber, filtros y acciones por fila. */
export function ChartListView({ canManage, loading, nodes, onCopyCode, onOpen, onToggleBlocked, range }: ChartListViewProps) {
  const actions = { canManage, onCopyCode, onOpen, onToggleBlocked, range };
  const columns: ResourceListColumn<ChartNode>[] = [
    {
      header: "Cuenta",
      alwaysVisible: true,
      cell: (node) => (
        <div className="flex min-w-0 items-center gap-2">
          <AccountCode code={node.code} parentCode={node.parentCode} />
          <span className={node.isPostable ? "truncate" : "truncate font-bold"}>{node.name}</span>
          {node.partnerId ? <PartnerBadge name={node.partnerName} taxId={node.partnerTaxId} /> : null}
          {node.isBlocked ? <BlockedIcon /> : null}
        </div>
      ),
      exportValue: (node) => `${node.code} ${node.name}`,
      sortValue: (node) => node.code,
    },
    {
      header: "Tipo",
      cell: (node) => <span className="text-xs">{statusLabel(accountTypeLabels, node.type)}{node.isPostable ? "" : ` · nivel ${node.level}`}</span>,
      exportValue: (node) => statusLabel(accountTypeLabels, node.type),
      sortValue: (node) => node.type,
    },
    {
      header: "Debe",
      className: "text-right",
      cell: (node) => <AmountCell cents={node.debitCents} />,
      exportValue: (node) => node.debitCents / 100,
      sortValue: (node) => node.debitCents,
    },
    {
      header: "Haber",
      className: "text-right",
      cell: (node) => <AmountCell cents={node.creditCents} />,
      exportValue: (node) => node.creditCents / 100,
      sortValue: (node) => node.creditCents,
    },
    {
      header: "Saldo",
      className: "text-right",
      cell: (node) => <BalanceCell cents={node.balanceCents} nature={node.nature} />,
      exportValue: (node) => node.balanceCents / 100,
      sortValue: (node) => node.balanceCents,
    },
    {
      header: "Acciones",
      className: "text-right",
      cell: (node) => <AccountActionsMenu node={node} {...actions} />,
    },
  ];

  return (
    <div aria-busy={loading || undefined}>
      <ResourceList
        columns={columns}
        emptyDescription="Ninguna cuenta cumple la búsqueda o los filtros."
        emptyTitle="Sin cuentas"
        exportFileName="plan-contable.csv"
        filters={[
          {
            key: "usage",
            label: "Uso",
            allLabel: "Grupos y subcuentas",
            options: [
              { label: "Solo cuentas de grupo", value: "group" },
              { label: "Solo subcuentas", value: "postable" },
            ],
            getValue: (node) => (node.isPostable ? "postable" : "group"),
          },
        ]}
        getRowId={(node) => node.id}
        getSearchText={(node) => `${node.code} ${node.name} ${node.partnerName ?? ""} ${node.partnerTaxId ?? ""}`}
        items={nodes}
        pageSize={50}
        pageSizeOptions={[25, 50, 100, 250]}
        renderMobileCard={(node) => (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <p className="flex flex-wrap items-center gap-1">
                <AccountCode code={node.code} parentCode={node.parentCode} />
                <span className="truncate font-medium">{node.name}</span>
                {node.isBlocked ? <BlockedIcon /> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Saldo <BalanceCell cents={node.balanceCents} nature={node.nature} /> · {balanceSideWord(node.balanceCents)}
              </p>
            </div>
            <AccountActionsMenu node={node} {...actions} />
          </div>
        )}
        searchPlaceholder="Buscar código, nombre, tercero o NIF…"
        testId="account-chart-list"
        title="Plan general contable"
      />
    </div>
  );
}
