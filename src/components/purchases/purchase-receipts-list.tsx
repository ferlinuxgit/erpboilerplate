"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";

export type PurchaseReceiptRow = {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  supplierName: string;
  receivedAt: Date | string;
  lineCount: number;
  totalQuantity: number;
  invoiceId: string | null;
};

const columns: ResourceListColumn<PurchaseReceiptRow>[] = [
  {
    header: "Recepción",
    cell: (row) => (
      <Link
        className="font-mono font-semibold text-primary hover:underline"
        href={`/purchases/receipts/${row.id}`}
      >
        {row.number}
      </Link>
    ),
    exportValue: (row) => row.number,
    sortValue: (row) => row.number,
  },
  {
    header: "Pedido",
    cell: (row) => (
      <div>
        <Link
          className="font-medium hover:underline"
          href={`/purchases/${row.orderId}`}
        >
          {row.orderNumber}
        </Link>
        <p className="text-xs text-muted-foreground">{row.supplierName}</p>
      </div>
    ),
    exportValue: (row) => row.orderNumber,
    sortValue: (row) => row.orderNumber,
  },
  {
    header: "Fecha",
    cell: (row) => formatDate(row.receivedAt),
    exportValue: (row) => formatDate(row.receivedAt),
    sortValue: (row) => new Date(row.receivedAt),
  },
  {
    header: "Líneas",
    cell: (row) => row.lineCount,
    exportValue: (row) => row.lineCount,
    sortValue: (row) => row.lineCount,
    className: "text-right",
  },
  {
    header: "Unidades",
    cell: (row) =>
      row.totalQuantity.toLocaleString("es-ES", { maximumFractionDigits: 3 }),
    exportValue: (row) => row.totalQuantity,
    sortValue: (row) => row.totalQuantity,
    className: "text-right",
  },
  {
    header: "Facturación",
    cell: (row) => (
      <StatusBadge tone={row.invoiceId ? "success" : "warning"}>
        {row.invoiceId ? "Facturada" : "Pendiente"}
      </StatusBadge>
    ),
    exportValue: (row) => (row.invoiceId ? "Facturada" : "Pendiente"),
    sortValue: (row) => (row.invoiceId ? 1 : 0),
  },
  {
    header: "Acciones",
    cell: (row) => (
      <Link
        className={buttonVariants({ variant: "outline", size: "sm" })}
        href={`/purchases/receipts/${row.id}`}
      >
        Ver
      </Link>
    ),
    className: "text-right",
  },
];

export function PurchaseReceiptsList({ rows }: { rows: PurchaseReceiptRow[] }) {
  return (
    <ResourceList
      columns={columns}
      emptyDescription="Las recepciones aparecerán cuando registres la entrada de un pedido de compra."
      emptyTitle="No hay recepciones registradas"
      exportFileName="recepciones-compra.csv"
      filters={[
        {
          key: "billing",
          label: "Facturación",
          allLabel: "Todos los estados",
          options: [
            { value: "PENDING", label: "Pendientes" },
            { value: "INVOICED", label: "Facturadas" },
          ],
          getValue: (row) => (row.invoiceId ? "INVOICED" : "PENDING"),
        },
      ]}
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        `${row.number} ${row.orderNumber} ${row.supplierName} ${row.invoiceId ? "facturada" : "pendiente"}`
      }
      items={rows}
      searchPlaceholder="Buscar por pedido, proveedor o recepción"
      testId="purchase-receipts-list"
      title="Recepciones"
    />
  );
}
