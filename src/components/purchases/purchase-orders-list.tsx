"use client";

import { PurchaseOrderRowActions } from "@/components/purchases/purchase-order-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";

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
};

function statusTone(status: string) {
  if (status === "RECEIVED" || status === "INVOICED" || status === "PAID") return "success";
  if (status === "SENT" || status === "APPROVED") return "info";
  if (status === "VOID" || status === "CANCELLED") return "danger";
  return "neutral";
}

const columns = (canManage: boolean): ResourceListColumn<PurchaseOrderRow>[] => [
  {
    header: "Pedido",
    cell: (order) => (
      <div>
        <p className="font-medium">{order.number}</p>
        <p className="text-sm text-muted-foreground">{order.supplierName}</p>
      </div>
    ),
    exportValue: (order) => order.number,
    sortValue: (order) => order.number,
  },
  {
    header: "Estado",
    cell: (order) => <StatusBadge tone={statusTone(order.status)}>{order.status}</StatusBadge>,
    exportValue: (order) => order.status,
    sortValue: (order) => order.status,
  },
  {
    header: "Creado",
    cell: (order) => formatDate(order.createdAt),
    exportValue: (order) => formatDate(order.createdAt),
    sortValue: (order) => new Date(order.createdAt),
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          cell: (order: PurchaseOrderRow) => <PurchaseOrderRowActions id={order.id} />,
          className: "text-right",
        },
      ]
    : []),
];

export function PurchaseOrdersList({ canManage = true, rows }: PurchaseOrdersListProps) {
  return (
    <ResourceList
      columns={columns(canManage)}
      emptyDescription="Crea un pedido con proveedor y líneas para habilitar la recepción."
      emptyTitle="No hay pedidos de compra todavía."
      exportFileName="pedidos-compra.csv"
      getRowId={(order) => order.id}
      getRowTestId={(order) => `purchase-order-row-${order.id}`}
      getSearchText={(order) => [order.number, order.supplierName, order.status, formatDate(order.createdAt)].join(" ")}
      items={rows}
      renderMobileCard={(order) => (
        <div className="space-y-3">
          <div>
            <p className="font-medium">{order.number}</p>
            <p className="text-sm text-muted-foreground">{order.supplierName}</p>
            <StatusBadge className="mt-2" tone={statusTone(order.status)}>{order.status}</StatusBadge>
            <p className="mt-2 text-sm text-muted-foreground">Creado: {formatDate(order.createdAt)}</p>
          </div>
          <PurchaseOrderRowActions id={order.id} />
        </div>
      )}
      searchPlaceholder="Buscar pedido por número, proveedor o estado"
      testId="purchase-orders-list"
      title="Pedidos de compra"
    />
  );
}
