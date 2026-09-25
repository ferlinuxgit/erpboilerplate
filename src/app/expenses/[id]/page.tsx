import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RegisterSupplierPaymentButton } from "@/components/purchases/register-supplier-payment-button";
import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supplierInvoice } from "@/db/schema";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import {
  invoicePaymentStatusLabels,
  invoicePaymentStatusTone,
  statusLabel,
} from "@/lib/status-labels";
import { getExpenseInvoice } from "@/server/supplier-invoices/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("expense.read");
    const { id } = await params;
    const [row] = await db
      .select({ number: supplierInvoice.number, supplierDocumentNumber: supplierInvoice.supplierDocumentNumber })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.id, id), eq(supplierInvoice.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Factura de proveedor ${row.supplierDocumentNumber || row.number}` : "Factura de proveedor" };
  } catch {
    return { title: "Factura de proveedor" };
  }
}

// Attachment URLs are user-provided: only render same-origin paths or http(s).
function isSafeAttachmentUrl(url: string) {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireContext("expense.read");
  const { id } = await params;
  const expense = await getExpenseInvoice(ctx.company.id, id);
  if (!expense) notFound();
  const canManage = can(ctx.membership.role, "purchase.write") || can(ctx.membership.role, "expense.write");
  const currency = expense.currencyCode ?? ctx.company.baseCurrencyCode;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Facturas de proveedor", href: "/expenses" },
          { label: expense.supplierDocumentNumber || expense.number },
        ]}
        title={expense.supplierDocumentNumber || expense.number}
        description={`${expense.supplierName} · ${formatDate(expense.issueDate)}`}
        meta={
          <StatusBadge tone={invoicePaymentStatusTone(expense.paymentStatus)}>
            {statusLabel(invoicePaymentStatusLabels, expense.paymentStatus)}
          </StatusBadge>
        }
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/suppliers/${expense.supplierPartnerId}`}
            >
              Ver proveedor
            </Link>
            {expense.purchaseOrderId ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/purchases/orders/${expense.purchaseOrderId}`}
              >
                Ver pedido
              </Link>
            ) : null}
            {expense.goodsReceiptId ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/purchases/receipts/${expense.goodsReceiptId}`}
              >
                Ver recepción
              </Link>
            ) : null}
            {canManage &&
            Number(expense.outstandingAmount) > 0 &&
            expense.paymentStatus !== "VOID" ? (
              <RegisterSupplierPaymentButton
                currencyCode={ctx.company.baseCurrencyCode}
                invoiceId={expense.id}
                outstandingAmount={Number(expense.outstandingAmount)}
              />
            ) : null}
            {canManage && expense.status === "VOID" ? (
              <DeleteButton
                description="La factura anulada, sus líneas, adjuntos y asientos contables compensados se eliminarán definitivamente."
                label="Eliminar"
                redirectTo="/expenses"
                successMessage="Factura anulada eliminada."
                title="Eliminar factura anulada"
                url={`/api/expenses/${expense.id}/hard-delete`}
              />
            ) : null}
          </>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Base" value={formatMoney(expense.subtotalAmount, currency)} />
        <MetricCard label="IVA" value={formatMoney(expense.taxAmount, currency)} />
        <MetricCard
          label="Retención"
          value={formatMoney(expense.retentionAmount, currency)}
        />
        <MetricCard
          label="Pendiente"
          value={formatMoney(expense.outstandingAmount, currency)}
          tone={Number(expense.outstandingAmount) > 0 ? "warning" : "success"}
        />
      </section>

      <PageSection
        title="Líneas"
        description="Desglose contable y fiscal de la factura."
      >
        <div className="overflow-x-auto rounded-[2px] border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right" title="Parte del IVA que se recupera">IVA deducible</TableHead>
                <TableHead className="text-right" title="Retención de IRPF">Retención</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expense.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell>
                    {line.expenseAccountCode
                      ? `${line.expenseAccountCode} - ${line.expenseAccountName}`
                      : "Cuenta por defecto"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(line.subtotalAmount, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(line.taxRate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(line.taxDeductiblePct)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(line.retentionRate)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(line.lineTotal, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageSection>

      <PageSection
        title="Pagos"
        description="Importes aplicados a esta factura de proveedor."
      >
        {expense.payments.length === 0 ? (
          <EmptyState
            title="Sin pagos"
            description={
              canManage && Number(expense.outstandingAmount) > 0 && expense.paymentStatus !== "VOID"
                ? "La factura conserva todo su saldo pendiente. Registra el pago desde la cabecera cuando se abone."
                : "La factura conserva todo su saldo pendiente."
            }
          />
        ) : (
          <div className="space-y-2">
            {expense.payments.map((payment) => (
              <div
                className="flex items-center justify-between border-b border-border/70 py-3 text-sm last:border-b-0"
                key={payment.id}
              >
                <div>
                  <p className="font-mono font-semibold">
                    {payment.number}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDate(payment.postedAt)}
                  </p>
                </div>
                <p className="font-mono font-semibold">
                  {formatMoney(
                    payment.amountApplied,
                    ctx.company.baseCurrencyCode,
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Adjuntos"
        description="Documentos vinculados a la factura de proveedor."
      >
        {expense.attachments.length === 0 ? (
          <EmptyState
            title="Sin adjuntos"
            description="Esta factura no tiene documentos vinculados."
          />
        ) : (
          <div className="space-y-2">
            {expense.attachments.map((attachment) => (
              <div
                className="flex items-center justify-between gap-3 rounded-[2px] border border-window-shadow p-3"
                key={attachment.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{attachment.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {attachment.contentType ?? "Documento"}
                  </p>
                </div>
                {isSafeAttachmentUrl(attachment.fileUrl) ? (
                  <Link
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    href={attachment.fileUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Abrir
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Enlace no disponible</span>
                )}
              </div>
            ))}
          </div>
        )}
      </PageSection>

      {expense.notes ? (
        <PageSection title="Notas" description="Observaciones internas.">
          <p className="whitespace-pre-wrap text-sm">{expense.notes}</p>
        </PageSection>
      ) : null}
    </PageShell>
  );
}
