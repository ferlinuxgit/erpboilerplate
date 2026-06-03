"use client";

import Link from "next/link";

import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { invoicePaymentStatusLabels, invoicePaymentStatusTone, statusLabel } from "@/lib/status-labels";

type InvoiceListRow = {
  id: string;
  number: string;
  status: string;
  totalAmount: string;
  totalAmountLabel: string;
  issueDate: Date | string;
  issueDateLabel: string;
  customerName: string;
};

type InvoicesListProps = {
  rows: InvoiceListRow[];
};

const columns: ResourceListColumn<InvoiceListRow>[] = [
  {
    header: "Factura",
    cell: (invoice) => (
      <div>
        <Link className="font-medium text-primary hover:underline" href={`/invoices/${invoice.id}`}>
          {invoice.number}
        </Link>
        <p className="text-sm text-muted-foreground">{invoice.customerName}</p>
      </div>
    ),
    exportValue: (invoice) => invoice.number,
    sortValue: (invoice) => invoice.number,
  },
  {
    header: "Estado",
    cell: (invoice) => (
      <StatusBadge tone={invoicePaymentStatusTone(invoice.status)}>{statusLabel(invoicePaymentStatusLabels, invoice.status)}</StatusBadge>
    ),
    exportValue: (invoice) => statusLabel(invoicePaymentStatusLabels, invoice.status),
    sortValue: (invoice) => invoice.status,
  },
  {
    header: "Importe",
    cell: (invoice) => invoice.totalAmountLabel,
    exportValue: (invoice) => invoice.totalAmountLabel,
    sortValue: (invoice) => Number(invoice.totalAmount),
  },
  {
    header: "Emisión",
    cell: (invoice) => invoice.issueDateLabel,
    exportValue: (invoice) => invoice.issueDateLabel,
    sortValue: (invoice) => new Date(invoice.issueDate),
  },
  {
    header: "Acciones",
    cell: (invoice) => <InvoiceRowActions id={invoice.id} number={invoice.number} />,
    className: "text-right",
  },
];

export function InvoicesList({ rows }: InvoicesListProps) {
  return (
    <ResourceList
      title="Facturas"
      items={rows}
      columns={columns}
      getRowId={(invoice) => invoice.id}
      getRowTestId={(invoice) => `invoice-row-${invoice.id}`}
      getSearchText={(invoice) => [invoice.number, invoice.customerName, invoice.status, statusLabel(invoicePaymentStatusLabels, invoice.status), invoice.totalAmountLabel, invoice.issueDateLabel].join(" ")}
      emptyTitle="Todavía no hay facturas registradas."
      emptyDescription="Crea la primera factura cuando tengas al menos un cliente activo."
      exportFileName="facturas.csv"
      searchPlaceholder="Buscar factura por número, cliente, estado o importe"
      testId="invoices-list"
      renderMobileCard={(invoice) => (
        <div className="space-y-3">
          <div>
            <Link className="font-medium text-primary hover:underline" href={`/invoices/${invoice.id}`}>
              {invoice.number} - {invoice.customerName}
            </Link>
            <p className="text-sm text-muted-foreground">Estado: {statusLabel(invoicePaymentStatusLabels, invoice.status)}</p>
            <p className="text-sm text-muted-foreground">Importe: {invoice.totalAmountLabel}</p>
            <p className="text-sm text-muted-foreground">Emisión: {invoice.issueDateLabel}</p>
          </div>
          <InvoiceRowActions id={invoice.id} number={invoice.number} />
        </div>
      )}
    />
  );
}
