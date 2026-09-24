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
    exportValue: (row) => Number(row.amount),
    sortValue: (row) => Number(row.amount),
    summary: (rows) => {
      if (new Set(rows.map((row) => row.currencyCode)).size > 1) return "Varias divisas";
      const cents = rows.reduce((total, row) => total + Math.round(Number(row.amount) * 100), 0);
      return formatMoney(cents / 100, rows[0]?.currencyCode ?? "EUR");
    },
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
      getRowLabel={(row) => `${row.number} · ${row.supplierName}`}
      getSearchText={(row) =>
        `${row.number} ${row.supplierNumber} ${row.invoiceNumber ?? "pago a cuenta"} ${row.supplierName} ${row.amount} ${formatMoney(row.amount, row.currencyCode)}`
      }
      dateRange={{ label: "Fecha de pago", getValue: (row) => row.postedAt }}
      summaryLabel="Total filtrado"
      renderMobileCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono font-semibold">{row.number}</p>
              <Link className="block truncate text-primary hover:underline" href={`/suppliers/${row.supplierId}`}>
                {row.supplierNumber} · {row.supplierName}
              </Link>
            </div>
            <p className="font-mono font-semibold tabular-nums">{formatMoney(row.amount, row.currencyCode)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Fecha</dt>
            <dd>{formatDate(row.postedAt)}</dd>
            <dt className="text-muted-foreground">Factura</dt>
            <dd>
              {row.invoiceId ? (
                <Link className="text-primary hover:underline" href={`/expenses/${row.invoiceId}`}>{row.invoiceNumber}</Link>
              ) : "Pago a cuenta"}
            </dd>
            <dt className="text-muted-foreground">Medio</dt>
            <dd>{row.paymentMethodName ?? "Sin especificar"}</dd>
            <dt className="text-muted-foreground">Referencia</dt>
            <dd>{row.bankName ?? row.reference ?? "Sin referencia"}</dd>
          </dl>
        </div>
      )}
      items={rows}
      searchPlaceholder="Buscar por proveedor, factura, pago a cuenta o importe"
      testId="supplier-payments-list"
      title="Pagos a proveedores"
    />
  );
}
