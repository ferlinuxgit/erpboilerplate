"use client";

import Link from "next/link";

import { PurchaseOrderRowActions } from "@/components/purchases/purchase-order-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
  type ServerListState,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import {
  purchaseOrderStatusLabels,
  purchaseOrderStatusTone,
  statusLabel,
} from "@/lib/status-labels";

type PurchaseOrderRow = {
  id: string;
  number: string;
  status: string;
  supplierName: string;
  createdAt: Date | string;
};

type PurchaseOrdersListProps = {
  canManage?: boolean;
  rows: PurchaseOrderRow[];
  /** Server pagination state; `rows` is then only the current page. */
  server?: ServerListState;
};

const columns = (
  canManage: boolean,
): ResourceListColumn<PurchaseOrderRow>[] => [
  {
    header: "Pedido",
    alwaysVisible: true,
    cell: (order) => (
      <Link
        className="font-mono font-semibold text-primary hover:underline"
        href={`/purchases/orders/${order.id}`}
      >
        {order.number}
      </Link>
    ),
    exportValue: (order) => order.number,
    sortValue: (order) => order.number,
    sortKey: "number",
  },
  {
    header: "Proveedor",
    cell: (order) => order.supplierName,
    exportValue: (order) => order.supplierName,
    sortValue: (order) => order.supplierName,
    sortKey: "supplier",
  },
  {
    header: "Estado",
    cell: (order) => (
      <StatusBadge tone={purchaseOrderStatusTone(order.status)}>
        {statusLabel(purchaseOrderStatusLabels, order.status)}
      </StatusBadge>
    ),
    exportValue: (order) =>
      statusLabel(purchaseOrderStatusLabels, order.status),
    sortValue: (order) => order.status,
    sortKey: "status",
  },
  {
    header: "Creado",
    cell: (order) => formatDate(order.createdAt),
    exportValue: (order) => formatDate(order.createdAt),
    sortValue: (order) => new Date(order.createdAt),
    sortKey: "createdAt",
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (order: PurchaseOrderRow) => (
            <PurchaseOrderRowActions id={order.id} number={order.number} />
          ),
          className: "text-right",
        },
      ]
    : []),
];

export function PurchaseOrdersList({
  canManage = true,
  rows,
  server,
}: PurchaseOrdersListProps) {
  return (
    <ResourceList
      columns={columns(canManage)}
      emptyDescription="Crea un pedido con proveedor y líneas para habilitar la recepción."
      emptyTitle="No hay pedidos de compra todavía."
      exportFileName="pedidos-compra.csv"
      getRowId={(order) => order.id}
      getRowLabel={(order) => order.number}
      getRowTestId={(order) => `purchase-order-row-${order.id}`}
      getSearchText={(order) =>
        [
          order.number,
          order.supplierName,
          order.status,
          statusLabel(purchaseOrderStatusLabels, order.status),
          formatDate(order.createdAt),
        ].join(" ")
      }
      items={rows}
      server={server}
      renderMobileCard={(order) => (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                className="font-mono font-semibold text-primary hover:underline"
                href={`/purchases/orders/${order.id}`}
              >
                {order.number}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {order.supplierName}
              </p>
            </div>
            <StatusBadge tone={purchaseOrderStatusTone(order.status)}>
              {statusLabel(purchaseOrderStatusLabels, order.status)}
            </StatusBadge>
          </div>
          <p className="text-xs text-muted-foreground">
            Creado: {formatDate(order.createdAt)}
          </p>
          {canManage ? (
            <PurchaseOrderRowActions id={order.id} number={order.number} />
          ) : null}
        </div>
      )}
      searchPlaceholder="Buscar pedido por número, proveedor o estado"
      testId="purchase-orders-list"
      title="Pedidos de compra"
      dateRange={{ label: "Fecha de creación", getValue: (order) => order.createdAt }}
      filters={[
        {
          key: "status",
          label: "Estado",
          allLabel: "Todos los estados",
          options: Object.entries(purchaseOrderStatusLabels).map(
            ([value, label]) => ({ value, label }),
          ),
          getValue: (order) => order.status,
        },
      ]}
    />
  );
}
