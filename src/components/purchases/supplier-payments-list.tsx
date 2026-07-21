"use client";

import Link from "next/link";

import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { formatDate, formatMoney } from "@/lib/format";

export type SupplierPaymentListRow = {
  id: string;
  number: string;
  supplierId: string;
  supplierNumber: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
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
        {row.number}
      </span>
    ),
    exportValue: (row) => row.number,
    sortValue: (row) => row.number,
  },
  {
    header: "Proveedor",
    cell: (row) => (
      <div>
        <Link className="font-medium text-primary hover:underline" href={`/suppliers/${row.supplierId}`}>{row.supplierNumber} · {row.supplierName}</Link>
        {row.invoiceId ? <Link className="block text-xs text-primary hover:underline" href={`/expenses/${row.invoiceId}`}>{row.invoiceNumber}</Link> : <p className="text-xs text-muted-foreground">Pago a cuenta</p>}
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
      emptyDescription="Los pagos aparecerán al registrarlos desde un proveedor o una factura."
      emptyTitle="No hay pagos registrados"
      exportFileName="pagos-proveedores.csv"
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        `${row.number} ${row.supplierNumber} ${row.invoiceNumber ?? "pago a cuenta"} ${row.supplierName} ${row.amount}`
      }
      items={rows}
      searchPlaceholder="Buscar por proveedor, factura, pago a cuenta o importe"
      testId="supplier-payments-list"
      title="Pagos a proveedores"
    />
  );
}
