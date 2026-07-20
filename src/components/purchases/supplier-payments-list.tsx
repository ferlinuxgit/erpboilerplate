"use client";

import Link from "next/link";

import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { formatDate, formatMoney } from "@/lib/format";

export type SupplierPaymentListRow = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  amount: string;
  postedAt: Date | string;
  currencyCode: string;
  reference: string | null;
  paymentMethodName: string | null;
  bankName: string | null;
};

const columns: ResourceListColumn<SupplierPaymentListRow>[] = [
  {
    header: "Pago",
    cell: (row) => (
      <span className="font-mono font-semibold">
        PAG-{row.id.slice(0, 8).toUpperCase()}
      </span>
    ),
    exportValue: (row) => row.id,
    sortValue: (row) => row.id,
  },
  {
    header: "Proveedor",
    cell: (row) => (
      <div>
        <p className="font-medium">{row.supplierName}</p>
        <Link
          className="text-xs text-primary hover:underline"
          href={`/expenses/${row.invoiceId}`}
        >
          {row.invoiceNumber}
        </Link>
      </div>
    ),
    exportValue: (row) => row.supplierName,
    sortValue: (row) => row.supplierName,
  },
  {
    header: "Fecha",
    cell: (row) => formatDate(row.postedAt),
    exportValue: (row) => formatDate(row.postedAt),
    sortValue: (row) => new Date(row.postedAt),
  },
  {
    header: "Medio",
    cell: (row) => <div><p>{row.paymentMethodName ?? "Sin especificar"}</p><p className="text-xs text-muted-foreground">{row.bankName ?? row.reference ?? "Sin referencia"}</p></div>,
    exportValue: (row) => [row.paymentMethodName, row.bankName, row.reference].filter(Boolean).join(" · "),
    sortValue: (row) => row.paymentMethodName ?? "",
  },
  {
    header: "Importe",
    cell: (row) => (
      <span className="font-mono font-semibold">
        {formatMoney(row.amount, row.currencyCode)}
      </span>
    ),
    exportValue: (row) => row.amount,
    sortValue: (row) => Number(row.amount),
    className: "text-right",
  },
];

export function SupplierPaymentsList({
  rows,
}: {
  rows: SupplierPaymentListRow[];
}) {
  return (
    <ResourceList
      columns={columns}
      emptyDescription="Los pagos aparecerán al aplicarlos a una factura de proveedor."
      emptyTitle="No hay pagos registrados"
      exportFileName="pagos-proveedores.csv"
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        `${row.id} ${row.invoiceNumber} ${row.supplierName} ${row.amount}`
      }
      items={rows}
      searchPlaceholder="Buscar por proveedor, factura o importe"
      testId="supplier-payments-list"
      title="Pagos a proveedores"
    />
  );
}
