"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";
import { invoicePaymentStatusLabels, invoicePaymentStatusTone, statusLabel } from "@/lib/status-labels";

type ExpenseInvoice = {
  id: string;
  number: string;
  supplierDocumentNumber: string | null;
  supplierName: string;
  issueDate: Date | string;
  dueDate: Date | string | null;
  paymentStatus: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
};

type ExpenseInvoicesListProps = {
  canManage: boolean;
  rows: ExpenseInvoice[];
};

export function ExpenseInvoicesList({ canManage, rows }: ExpenseInvoicesListProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [voidingInvoice, setVoidingInvoice] = useState<ExpenseInvoice | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);

  async function payInvoice(invoice: ExpenseInvoice) {
    setLoadingId(invoice.id);
    try {
      const response = await fetch("/api/supplier-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          supplierInvoiceId: invoice.id,
          amountApplied: Number(invoice.outstandingAmount),
          postedAt: new Date().toISOString(),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo registrar el pago.");
      }
      toast.success("Pago de gasto registrado.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoadingId(null);
    }
  }

  async function voidInvoice(invoice: ExpenseInvoice) {
    setLoadingId(invoice.id);
    setVoidError(null);
    try {
      const response = await fetch(`/api/expenses/${invoice.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ reason: "Anulado desde control de gastos." }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? "No se pudo anular el gasto.");
      }
      toast.success("Gasto anulado con asiento inverso.");
      setVoidingInvoice(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado.";
      setVoidError(message);
      toast.error(message);
    } finally {
      setLoadingId(null);
    }
  }

  const canVoid = (invoice: ExpenseInvoice) => canManage && Number(invoice.paidAmount) === 0 && invoice.paymentStatus !== "VOID";
  const canPay = (invoice: ExpenseInvoice) => canManage && Number(invoice.outstandingAmount) > 0 && invoice.paymentStatus !== "VOID";

  const columns: ResourceListColumn<ExpenseInvoice>[] = [
    {
      header: "Proveedor",
      cell: (invoice) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{invoice.supplierName}</p>
          <p className="text-xs text-muted-foreground">{invoice.supplierDocumentNumber || invoice.number}</p>
        </div>
      ),
      exportValue: (invoice) => invoice.supplierName,
      sortValue: (invoice) => invoice.supplierName,
    },
    {
      header: "Fecha",
      cell: (invoice) => formatDate(invoice.issueDate),
      exportValue: (invoice) => formatDate(invoice.issueDate),
      sortValue: (invoice) => new Date(invoice.issueDate),
    },
    {
      header: "Vence",
      cell: (invoice) => invoice.dueDate ? formatDate(invoice.dueDate) : "Sin vencimiento",
      exportValue: (invoice) => invoice.dueDate ? formatDate(invoice.dueDate) : "",
      sortValue: (invoice) => invoice.dueDate ? new Date(invoice.dueDate) : null,
    },
    {
      header: "Estado",
      cell: (invoice) => (
        <StatusBadge tone={invoicePaymentStatusTone(invoice.paymentStatus)}>
          {statusLabel(invoicePaymentStatusLabels, invoice.paymentStatus)}
        </StatusBadge>
      ),
      exportValue: (invoice) => statusLabel(invoicePaymentStatusLabels, invoice.paymentStatus),
      sortValue: (invoice) => invoice.paymentStatus,
    },
    {
      header: "Total",
      className: "text-right",
      cell: (invoice) => formatMoney(invoice.totalAmount),
      exportValue: (invoice) => invoice.totalAmount,
      sortValue: (invoice) => Number(invoice.totalAmount),
    },
    {
      header: "Pendiente",
      className: "text-right",
      cell: (invoice) => formatMoney(invoice.outstandingAmount),
      exportValue: (invoice) => invoice.outstandingAmount,
      sortValue: (invoice) => Number(invoice.outstandingAmount),
    },
    {
      header: "Acciones",
      className: "text-right",
      cell: (invoice) => (
        <div className="flex justify-end gap-2">
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/expenses/${invoice.id}`}>Ver</Link>
          {canPay(invoice) ? (
            <Button disabled={loadingId === invoice.id} onClick={() => payInvoice(invoice)} size="sm" type="button">
              {loadingId === invoice.id ? "Pagando..." : "Pagar"}
            </Button>
          ) : null}
          {canVoid(invoice) ? (
            <Button disabled={loadingId === invoice.id} onClick={() => setVoidingInvoice(invoice)} size="sm" type="button" variant="destructive">
              Anular
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <ResourceList
        columns={columns}
        emptyDescription="Registra gastos directos como gasolina, luz, telefono, alquileres o servicios profesionales."
        emptyTitle="Sin gastos registrados"
        exportFileName="gastos.csv"
        getRowId={(invoice) => invoice.id}
        getRowTestId={(invoice) => `expense-invoice-${invoice.number}`}
        getSearchText={(invoice) => `${invoice.number} ${invoice.supplierDocumentNumber ?? ""} ${invoice.supplierName} ${invoice.paymentStatus}`}
        items={rows}
        renderMobileCard={(invoice) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{invoice.supplierName}</p>
                <p className="text-xs text-muted-foreground">{invoice.supplierDocumentNumber || invoice.number}</p>
              </div>
              <StatusBadge tone={invoicePaymentStatusTone(invoice.paymentStatus)}>
                {statusLabel(invoicePaymentStatusLabels, invoice.paymentStatus)}
              </StatusBadge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p>Fecha {formatDate(invoice.issueDate)}</p>
              <p>Total {formatMoney(invoice.totalAmount)}</p>
              <p>Pendiente {formatMoney(invoice.outstandingAmount)}</p>
              <p>{invoice.dueDate ? `Vence ${formatDate(invoice.dueDate)}` : "Sin vencimiento"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/expenses/${invoice.id}`}>Ver</Link>
              {canPay(invoice) ? (
                <Button disabled={loadingId === invoice.id} onClick={() => payInvoice(invoice)} size="sm" type="button">
                  {loadingId === invoice.id ? "Pagando..." : "Pagar"}
                </Button>
              ) : null}
              {canVoid(invoice) ? (
                <Button disabled={loadingId === invoice.id} onClick={() => setVoidingInvoice(invoice)} size="sm" type="button" variant="destructive">
                  Anular
                </Button>
              ) : null}
            </div>
          </div>
        )}
        searchPlaceholder="Buscar por proveedor, factura o estado"
        testId="expenses-list"
        title="Facturas de gasto"
      />
      <DestructiveActionDialog
        confirmLabel="Anular"
        description="Se registrará un asiento inverso y el gasto quedará marcado como anulado. Solo se permite si no tiene pagos."
        errorMessage={voidError}
        isSubmitting={loadingId === voidingInvoice?.id}
        onCancel={() => {
          setVoidingInvoice(null);
          setVoidError(null);
        }}
        onConfirm={() => {
          if (voidingInvoice) void voidInvoice(voidingInvoice);
        }}
        open={Boolean(voidingInvoice)}
        title="Anular gasto"
      />
    </>
  );
}
