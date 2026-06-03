import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { requireContext } from "@/lib/current-context";
import { invoicePaymentStatusLabels, invoicePaymentStatusTone, statusLabel } from "@/lib/status-labels";
import { getExpenseInvoice } from "@/server/supplier-invoices/service";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("expense.read");
  const { id } = await params;
  const expense = await getExpenseInvoice(ctx.company.id, id);
  if (!expense) notFound();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Gastos"
        title={expense.supplierDocumentNumber || expense.number}
        description={`${expense.supplierName} · ${formatDate(expense.issueDate)}`}
        backHref="/expenses"
        backLabel="Volver a gastos"
        meta={
          <StatusBadge tone={invoicePaymentStatusTone(expense.paymentStatus)}>
            {statusLabel(invoicePaymentStatusLabels, expense.paymentStatus)}
          </StatusBadge>
        }
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Base" value={formatMoney(expense.subtotalAmount)} />
        <MetricCard label="IVA" value={formatMoney(expense.taxAmount)} />
        <MetricCard label="Retención" value={formatMoney(expense.retentionAmount)} />
        <MetricCard label="Pendiente" value={formatMoney(expense.outstandingAmount)} tone={Number(expense.outstandingAmount) > 0 ? "warning" : "success"} />
      </section>

      <PageSection title="Líneas" description="Desglose contable y fiscal del gasto.">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Ded.</TableHead>
                <TableHead className="text-right">Ret.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expense.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell>{line.expenseAccountCode ? `${line.expenseAccountCode} - ${line.expenseAccountName}` : "Cuenta por defecto"}</TableCell>
                  <TableCell className="text-right">{formatMoney(line.subtotalAmount)}</TableCell>
                  <TableCell className="text-right">{Number(line.taxRate).toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{Number(line.taxDeductiblePct).toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{Number(line.retentionRate).toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{formatMoney(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageSection>

      <PageSection title="Adjuntos" description="Documentos vinculados a la factura de gasto.">
        {expense.attachments.length === 0 ? (
          <EmptyState title="Sin adjuntos" description="Esta factura no tiene documentos vinculados." />
        ) : (
          <div className="space-y-2">
            {expense.attachments.map((attachment) => (
              <div className="flex items-center justify-between gap-3 rounded-md border p-3" key={attachment.id}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{attachment.fileName}</p>
                  <p className="text-xs text-muted-foreground">{attachment.contentType ?? "Documento"}</p>
                </div>
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={attachment.fileUrl} target="_blank">
                  Abrir
                </Link>
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
