"use client";

import Link from "next/link";

import { DunningOptOutMenuItem } from "@/components/dunning/dunning-opt-out-toggle";
import { BulkInvoiceEmailButton } from "@/components/invoice-email/bulk-invoice-email-actions";
import { SendInvoiceEmailDialog } from "@/components/invoice-email/send-invoice-email-dialog";
import { DropdownMenu, DropdownMenuLinkItem } from "@/components/ui/dropdown-menu";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { AGING_BUCKETS, agingBucketLabels, type AgingBucket, type ReminderLevel } from "@/server/dunning/schedule";
import { formatScheduleDate } from "@/server/recurring/schedule";

export type CollectionListRow = {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  optedOut: boolean;
  dueDate: string | null;
  outstandingAmount: number;
  daysOverdue: number | null;
  bucket: AgingBucket;
  remindersSent: number;
  lastReminderLabel: string | null;
  nextLevel: ReminderLevel;
};

const bucketTone: Record<AgingBucket, "neutral" | "info" | "warning" | "danger"> = {
  CURRENT: "neutral",
  D0_30: "info",
  D31_60: "warning",
  D61_90: "danger",
  D90_PLUS: "danger",
};

function overdueLabel(row: CollectionListRow) {
  if (row.daysOverdue === null) return "Sin vencimiento";
  if (row.daysOverdue <= 0) return row.daysOverdue === 0 ? "Vence hoy" : `Vence en ${-row.daysOverdue} días`;
  return row.daysOverdue === 1 ? "Vencida ayer" : `Vencida hace ${row.daysOverdue} días`;
}

/** Cobros pendientes con antigüedad, último recordatorio y reclamación individual o en bloque. */
export function CollectionsList({ canRemind, currencyCode = "EUR", rows }: { rows: CollectionListRow[]; currencyCode?: string; canRemind: boolean }) {
  const renderActions = (row: CollectionListRow) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {canRemind && (row.daysOverdue ?? 0) > 0 && !row.optedOut ? (
        <SendInvoiceEmailDialog invoiceId={row.invoiceId} kind="REMINDER" number={row.number} reminderLevel={row.nextLevel} triggerSize="sm" />
      ) : null}
      <DropdownMenu label={`Más acciones de ${row.number}`} trigger="Más">
        <DropdownMenuLinkItem href={`/invoices/${row.invoiceId}`}>Ver factura</DropdownMenuLinkItem>
        <DropdownMenuLinkItem href={`/customers/${row.customerId}`}>Ver cliente</DropdownMenuLinkItem>
        {canRemind ? <DunningOptOutMenuItem customerId={row.customerId} customerName={row.customerName} optedOut={row.optedOut} /> : null}
      </DropdownMenu>
    </div>
  );

  const columns: ResourceListColumn<CollectionListRow>[] = [
    {
      header: "Factura",
      alwaysVisible: true,
      cell: (row) => <Link className="font-mono font-semibold text-primary hover:underline" href={`/invoices/${row.invoiceId}`}>{row.number}</Link>,
      exportValue: (row) => row.number,
      sortValue: (row) => row.number,
    },
    {
      header: "Cliente",
      cell: (row) => (
        <span>
          {row.customerName}
          {row.optedOut ? <span className="ml-1"><StatusBadge tone="neutral">Sin recordatorios</StatusBadge></span> : null}
          {!row.customerEmail ? <span className="block text-xs text-muted-foreground">Sin email</span> : null}
        </span>
      ),
      exportValue: (row) => row.customerName,
      sortValue: (row) => row.customerName,
    },
    {
      header: "Vencimiento",
      cell: (row) => (
        <span className={(row.daysOverdue ?? 0) > 0 ? "font-semibold text-destructive" : undefined}>
          {row.dueDate ? formatScheduleDate(row.dueDate) : "—"}
          <span className="block text-xs font-normal text-muted-foreground">{overdueLabel(row)}</span>
        </span>
      ),
      exportValue: (row) => row.dueDate ?? "",
      sortValue: (row) => row.dueDate,
    },
    {
      header: "Antigüedad",
      cell: (row) => <StatusBadge tone={bucketTone[row.bucket]}>{agingBucketLabels[row.bucket]}</StatusBadge>,
      exportValue: (row) => agingBucketLabels[row.bucket],
      sortValue: (row) => row.daysOverdue ?? -100000,
    },
    {
      header: "Pendiente",
      className: "text-right font-mono tabular-nums",
      cell: (row) => formatMoney(row.outstandingAmount, currencyCode),
      exportValue: (row) => row.outstandingAmount,
      sortValue: (row) => row.outstandingAmount,
      summary: (filtered) => formatMoney(filtered.reduce((sum, row) => sum + Math.round(row.outstandingAmount * 100), 0) / 100, currencyCode),
    },
    {
      header: "Último recordatorio",
      cell: (row) => (row.lastReminderLabel ? `${row.lastReminderLabel} (${row.remindersSent} ${row.remindersSent === 1 ? "enviado" : "enviados"})` : <span className="text-muted-foreground">Ninguno</span>),
      exportValue: (row) => row.lastReminderLabel ?? "",
      sortValue: (row) => row.remindersSent,
    },
    { header: "Acciones", cell: renderActions, className: "text-right" },
  ];

  return (
    <ResourceList
      bulkActions={canRemind ? (selected, clear) => (
        <BulkInvoiceEmailButton invoiceIds={selected.map((row) => row.invoiceId)} mode="remind" onDone={clear} />
      ) : undefined}
      columns={columns}
      emptyDescription="Cuando una factura emitida tenga importe pendiente aparecerá aquí."
      emptyTitle="No hay nada pendiente de cobro."
      exportFileName="cobros-pendientes.csv"
      filters={[
        {
          key: "bucket",
          label: "Antigüedad",
          allLabel: "Todas",
          options: AGING_BUCKETS.map((bucket) => ({ value: bucket, label: agingBucketLabels[bucket] })),
          getValue: (row) => row.bucket,
        },
        {
          key: "due",
          label: "Vencimiento",
          allLabel: "Vencidas y sin vencer",
          options: [{ value: "overdue", label: "Solo vencidas" }],
          getValue: (row) => ((row.daysOverdue ?? 0) > 0 ? "overdue" : ""),
        },
      ]}
      getRowClassName={(row) => ((row.daysOverdue ?? 0) > 60 ? "bg-destructive/10" : undefined)}
      getRowId={(row) => row.invoiceId}
      getRowLabel={(row) => row.number}
      getSearchText={(row) => [row.number, row.customerName, agingBucketLabels[row.bucket], row.customerEmail ?? ""].join(" ")}
      items={rows}
      renderMobileCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Link className="font-mono font-semibold text-primary hover:underline" href={`/invoices/${row.invoiceId}`}>{row.number}</Link>
            <StatusBadge tone={bucketTone[row.bucket]}>{agingBucketLabels[row.bucket]}</StatusBadge>
          </div>
          <p className="text-sm">{row.customerName}</p>
          <p className="text-xs text-muted-foreground">{overdueLabel(row)} · Último recordatorio: {row.lastReminderLabel ?? "ninguno"}</p>
          <p className="font-mono text-sm font-semibold">{formatMoney(row.outstandingAmount, currencyCode)}</p>
          {renderActions(row)}
        </div>
      )}
      searchPlaceholder="Buscar por factura o cliente"
      summaryLabel="Total pendiente"
      testId="collections-list"
      title="Cobros pendientes"
    />
  );
}
