"use client";

import Link from "next/link";

import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
  type ServerListState,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import {
  invoicePaymentStatusLabels,
  invoicePaymentStatusTone,
  statusLabel,
} from "@/lib/status-labels";

type InvoiceListRow = {
  id: string;
  number: string;
  status: string;
  lifecycle: "DRAFT" | "ISSUED" | "VOID";
  invoiceType: "INVOICE" | "CREDIT_NOTE";
  totalAmount: string;
  totalAmountLabel: string;
  outstandingAmount: number;
  outstandingAmountLabel: string;
  issueDate: Date | string;
  issueDateLabel: string;
  dueDate: Date | string | null;
  dueDateLabel: string | null;
  isOverdue: boolean;
  customerName: string;
};

type InvoicesListProps = {
  rows: InvoiceListRow[];
  paymentMethods: Array<{ id: string; name: string }>;
  currencyCode?: string;
  /** Server pagination state; `rows` is then only the current page. */
  server?: ServerListState;
  /** Footer totals over every filtered invoice (server mode). */
  totals?: { totalAmount: number; outstandingAmount: number };
};

function sumAmounts(rows: InvoiceListRow[], pick: (row: InvoiceListRow) => number) {
  // Work in cents to avoid floating point drift on long lists.
  return rows.reduce((total, row) => total + Math.round(pick(row) * 100), 0) / 100;
}

const DRAFT_LABEL = "Borrador";

/** Drafts only have a provisional code (BORRADOR-xxxx): the list shows "Borrador" instead. */
function displayNumber(invoice: InvoiceListRow) {
  return invoice.lifecycle === "DRAFT" ? DRAFT_LABEL : invoice.number;
}

/** Accessible name for a row (drafts have no number yet, so the customer tells them apart). */
function rowLabel(invoice: InvoiceListRow) {
  return invoice.lifecycle === "DRAFT" ? `Borrador de ${invoice.customerName}` : invoice.number;
}

/** Drafts and credit notes have nothing to collect. */
function hasOutstanding(invoice: InvoiceListRow) {
  return invoice.lifecycle !== "DRAFT" && invoice.invoiceType !== "CREDIT_NOTE";
}

function typeFilterValue(invoice: InvoiceListRow) {
  if (invoice.lifecycle === "DRAFT") return "draft";
  return invoice.invoiceType === "CREDIT_NOTE" ? "credit_note" : "invoice";
}

function DocumentBadges({ invoice }: { invoice: InvoiceListRow }) {
  return (
    <>
      {invoice.lifecycle === "DRAFT" ? <StatusBadge tone="neutral">Borrador</StatusBadge> : null}
      {invoice.invoiceType === "CREDIT_NOTE" ? <StatusBadge tone="info">Rectificativa</StatusBadge> : null}
    </>
  );
}

function StatusCell({ invoice }: { invoice: InvoiceListRow }) {
  return (
    <>
      <DocumentBadges invoice={invoice} />
      {invoice.lifecycle === "DRAFT" && invoice.status !== "VOID" ? null : (
        <StatusBadge tone={invoicePaymentStatusTone(invoice.status)}>
          {statusLabel(invoicePaymentStatusLabels, invoice.status)}
        </StatusBadge>
      )}
      <OverdueBadge invoice={invoice} />
    </>
  );
}

function statusExportValue(invoice: InvoiceListRow) {
  return [
    invoice.lifecycle === "DRAFT" ? "Borrador" : null,
    invoice.invoiceType === "CREDIT_NOTE" ? "Rectificativa" : null,
    invoice.lifecycle === "DRAFT" && invoice.status !== "VOID" ? null : statusLabel(invoicePaymentStatusLabels, invoice.status),
    invoice.isOverdue && invoice.status !== "OVERDUE" ? "Vencida" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Vencida" is shown as text too, so overdue rows are not signalled by colour only. */
function OverdueBadge({ invoice }: { invoice: InvoiceListRow }) {
  if (!invoice.isOverdue || invoice.status === "OVERDUE") return null;
  return <StatusBadge tone="danger">Vencida</StatusBadge>;
}

export function InvoicesList({ currencyCode = "EUR", paymentMethods, rows, server, totals }: InvoicesListProps) {
  const renderActions = (invoice: InvoiceListRow) => (
    <InvoiceRowActions
      id={invoice.id}
      invoiceType={invoice.invoiceType}
      lifecycle={invoice.lifecycle}
      number={rowLabel(invoice)}
      outstandingAmount={invoice.outstandingAmount}
      paymentMethods={paymentMethods}
      paymentStatus={invoice.status}
      totalAmount={Number(invoice.totalAmount)}
      totalAmountLabel={invoice.totalAmountLabel}
    />
  );

  const columns: ResourceListColumn<InvoiceListRow>[] = [
    {
      header: "Número",
      alwaysVisible: true,
      cell: (invoice) => (
        <Link
          className="font-mono font-semibold text-primary hover:underline"
          href={`/invoices/${invoice.id}`}
          title={invoice.lifecycle === "DRAFT" ? "Borrador: recibirá su número definitivo al emitirse" : undefined}
        >
          {displayNumber(invoice)}
        </Link>
      ),
      exportValue: (invoice) => displayNumber(invoice),
      sortValue: (invoice) => invoice.number,
      sortKey: "number",
    },
    {
      header: "Cliente",
      cell: (invoice) => invoice.customerName,
      exportValue: (invoice) => invoice.customerName,
      sortValue: (invoice) => invoice.customerName,
      sortKey: "customer",
    },
    {
      header: "Fecha emisión",
      cell: (invoice) => invoice.issueDateLabel,
      exportValue: (invoice) => invoice.issueDateLabel,
      sortValue: (invoice) => new Date(invoice.issueDate),
      sortKey: "issueDate",
    },
    {
      header: "Vencimiento",
      cell: (invoice) => (
        <span className={invoice.isOverdue ? "font-semibold text-destructive" : undefined}>
          {invoice.dueDateLabel ?? "Sin vencimiento"}
        </span>
      ),
      exportValue: (invoice) => invoice.dueDateLabel ?? "",
      sortValue: (invoice) => (invoice.dueDate ? new Date(invoice.dueDate) : null),
      sortKey: "dueDate",
    },
    {
      header: "Total",
      className: "text-right font-mono tabular-nums",
      cell: (invoice) => invoice.totalAmountLabel,
      exportValue: (invoice) => Number(invoice.totalAmount),
      sortValue: (invoice) => Number(invoice.totalAmount),
      sortKey: "total",
      summary: (filtered) =>
        formatMoney(totals ? totals.totalAmount : sumAmounts(filtered, (row) => Number(row.totalAmount)), currencyCode),
    },
    {
      header: "Pendiente",
      className: "text-right font-mono tabular-nums",
      cell: (invoice) =>
        hasOutstanding(invoice) ? (
          invoice.outstandingAmountLabel
        ) : (
          <span className="text-muted-foreground" title={invoice.lifecycle === "DRAFT" ? "Un borrador no se cobra hasta emitirse" : "Una rectificativa reduce el pendiente de la factura original"}>
            —
          </span>
        ),
      exportValue: (invoice) => invoice.outstandingAmount,
      sortValue: (invoice) => invoice.outstandingAmount,
      sortKey: "outstanding",
      summary: (filtered) =>
        formatMoney(totals ? totals.outstandingAmount : sumAmounts(filtered, (row) => row.outstandingAmount), currencyCode),
    },
    {
      header: "Estado",
      cell: (invoice) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusCell invoice={invoice} />
        </div>
      ),
      exportValue: statusExportValue,
      sortValue: (invoice) => invoice.status,
      sortKey: "status",
    },
    {
      header: "Acciones",
      cell: renderActions,
      className: "text-right",
    },
  ];

  return (
    <ResourceList
      title="Facturas"
      items={rows}
      server={server}
      columns={columns}
      getRowId={(invoice) => invoice.id}
      getRowTestId={(invoice) => `invoice-row-${invoice.id}`}
      getRowLabel={rowLabel}
      getRowClassName={(invoice) => (invoice.isOverdue ? "bg-destructive/10" : undefined)}
      getSearchText={(invoice) =>
        [
          invoice.number,
          displayNumber(invoice),
          invoice.invoiceType === "CREDIT_NOTE" ? "Rectificativa" : "",
          invoice.customerName,
          invoice.status,
          statusLabel(invoicePaymentStatusLabels, invoice.status),
          invoice.isOverdue ? "Vencida" : "",
          invoice.totalAmountLabel,
          invoice.outstandingAmountLabel,
          invoice.issueDateLabel,
          invoice.dueDateLabel ?? "",
        ].join(" ")
      }
      emptyTitle="Todavía no hay facturas registradas."
      emptyDescription="Crea la primera factura cuando tengas al menos un cliente activo."
      exportFileName="facturas.csv"
      searchPlaceholder="Buscar factura por número, cliente o importe"
      testId="invoices-list"
      summaryLabel="Total filtrado"
      dateRange={{ label: "Fecha de emisión", getValue: (invoice) => invoice.issueDate }}
      filters={[
        {
          key: "status",
          label: "Estado de cobro",
          allLabel: "Todos los estados",
          options: Object.entries(invoicePaymentStatusLabels).map(
            ([value, label]) => ({ value, label }),
          ),
          getValue: (invoice) => invoice.status,
        },
        {
          key: "due",
          label: "Vencimiento",
          allLabel: "Todos los vencimientos",
          options: [{ value: "overdue", label: "Solo vencidas" }],
          getValue: (invoice) => (invoice.isOverdue ? "overdue" : ""),
        },
        {
          key: "type",
          label: "Tipo",
          allLabel: "Todos los tipos",
          options: [
            { value: "invoice", label: "Facturas" },
            { value: "credit_note", label: "Rectificativas" },
            { value: "draft", label: "Borradores" },
          ],
          getValue: typeFilterValue,
        },
      ]}
      renderMobileCard={(invoice) => (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                className="font-mono font-semibold text-primary hover:underline"
                href={`/invoices/${invoice.id}`}
              >
                {displayNumber(invoice)}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{invoice.customerName}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              <StatusCell invoice={invoice} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Emisión</dt>
            <dd>{invoice.issueDateLabel}</dd>
            <dt className="text-muted-foreground">Vencimiento</dt>
            <dd className={invoice.isOverdue ? "font-semibold text-destructive" : undefined}>
              {invoice.dueDateLabel ?? "Sin vencimiento"}
            </dd>
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-mono tabular-nums">{invoice.totalAmountLabel}</dd>
            <dt className="text-muted-foreground">Pendiente</dt>
            <dd className="font-mono tabular-nums">{hasOutstanding(invoice) ? invoice.outstandingAmountLabel : "—"}</dd>
          </dl>
          {renderActions(invoice)}
        </div>
      )}
    />
  );
}
