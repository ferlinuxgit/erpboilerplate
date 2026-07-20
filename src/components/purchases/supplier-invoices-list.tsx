"use client";

import Link from "next/link";

import { RegisterSupplierPaymentButton } from "@/components/purchases/register-supplier-payment-button";
import { buttonVariants } from "@/components/ui/button";
import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import {
  invoicePaymentStatusLabels,
  invoicePaymentStatusTone,
  statusLabel,
} from "@/lib/status-labels";

export type SupplierInvoiceListRow = {
  id: string;
  number: string;
  supplierDocumentNumber: string | null;
  supplierName: string;
  orderId: string | null;
  orderNumber: string | null;
  issueDate: Date | string;
  dueDate: Date | string | null;
  origin: string;
  paymentStatus: string;
  totalAmount: string;
  outstandingAmount: string;
  currencyCode: string;
  canManage: boolean;
};

export function SupplierInvoicesList({
  rows,
}: {
  rows: SupplierInvoiceListRow[];
}) {
  const columns: ResourceListColumn<SupplierInvoiceListRow>[] = [
    {
      header: "Factura",
      cell: (row) => (
        <div>
          <Link
            className="font-mono font-semibold text-primary hover:underline"
            href={`/expenses/${row.id}?returnTo=supplier-invoices`}
          >
            {row.supplierDocumentNumber ?? row.number}
          </Link>
          <p className="text-xs text-muted-foreground">{row.supplierName}</p>
        </div>
      ),
      exportValue: (row) => row.supplierDocumentNumber ?? row.number,
      sortValue: (row) => row.supplierDocumentNumber ?? row.number,
    },
    {
      header: "Pedido",
      cell: (row) =>
        row.orderId ? (
          <Link className="hover:underline" href={`/purchases/${row.orderId}`}>
            {row.orderNumber}
          </Link>
        ) : (
          "Sin pedido"
        ),
      exportValue: (row) => row.orderNumber ?? "",
      sortValue: (row) => row.orderNumber ?? "",
    },
    {
      header: "Origen",
      cell: (row) => (
        <StatusBadge tone={row.origin === "PURCHASE" ? "info" : "neutral"}>
          {row.origin === "PURCHASE" ? "Pedido" : "Directa"}
        </StatusBadge>
      ),
      exportValue: (row) => (row.origin === "PURCHASE" ? "Pedido" : "Directa"),
      sortValue: (row) => row.origin,
    },
    {
      header: "Emisión",
      cell: (row) => formatDate(row.issueDate),
      exportValue: (row) => formatDate(row.issueDate),
      sortValue: (row) => new Date(row.issueDate),
    },
    {
      header: "Vencimiento",
      cell: (row) =>
        row.dueDate ? formatDate(row.dueDate) : "Sin vencimiento",
      exportValue: (row) => (row.dueDate ? formatDate(row.dueDate) : ""),
      sortValue: (row) => (row.dueDate ? new Date(row.dueDate) : null),
    },
    {
      header: "Estado",
      cell: (row) => (
        <StatusBadge tone={invoicePaymentStatusTone(row.paymentStatus)}>
          {statusLabel(invoicePaymentStatusLabels, row.paymentStatus)}
        </StatusBadge>
      ),
      exportValue: (row) =>
        statusLabel(invoicePaymentStatusLabels, row.paymentStatus),
      sortValue: (row) => row.paymentStatus,
    },
    {
      header: "Total",
      cell: (row) => formatMoney(row.totalAmount, row.currencyCode),
      exportValue: (row) => row.totalAmount,
      sortValue: (row) => Number(row.totalAmount),
      className: "text-right",
    },
    {
      header: "Pendiente",
      cell: (row) => formatMoney(row.outstandingAmount, row.currencyCode),
      exportValue: (row) => row.outstandingAmount,
      sortValue: (row) => Number(row.outstandingAmount),
      className: "text-right",
    },
    {
      header: "Acciones",
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`/expenses/${row.id}?returnTo=supplier-invoices`}
          >
            Ver
          </Link>
          {row.canManage &&
          Number(row.outstandingAmount) > 0 &&
          row.paymentStatus !== "VOID" ? (
            <RegisterSupplierPaymentButton
              invoiceId={row.id}
              outstandingAmount={Number(row.outstandingAmount)}
              compact
            />
          ) : null}
        </div>
      ),
      className: "text-right",
    },
  ];

  return (
    <ResourceList
      columns={columns}
      emptyDescription="Genera una factura desde una recepción o registra una factura directa de proveedor."
      emptyTitle="No hay facturas de proveedor"
      exportFileName="facturas-proveedor.csv"
      filters={[
        {
          key: "origin",
          label: "Origen",
          allLabel: "Todos los orígenes",
          options: [
            { value: "PURCHASE", label: "Desde pedido" },
            { value: "EXPENSE", label: "Factura directa" },
          ],
          getValue: (row) => row.origin,
        },
        {
          key: "status",
          label: "Estado de pago",
          allLabel: "Todos los estados",
          options: Object.entries(invoicePaymentStatusLabels).map(
            ([value, label]) => ({ value, label }),
          ),
          getValue: (row) => row.paymentStatus,
        },
      ]}
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        `${row.number} ${row.supplierDocumentNumber ?? ""} ${row.supplierName} ${row.orderNumber ?? ""} ${row.origin} ${row.paymentStatus}`
      }
      items={rows}
      searchPlaceholder="Buscar por factura, proveedor, pedido o estado"
      testId="supplier-invoices-list"
      title="Facturas de proveedor"
    />
  );
}
