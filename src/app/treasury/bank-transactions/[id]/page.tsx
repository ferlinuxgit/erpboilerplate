import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/delete-button";
import { ManualReconcileButton } from "@/components/treasury/manual-reconcile-button";
import {
  PENDING_ACCOUNT_EXPLANATION,
  movementStatusDescriptions,
  movementStatusKey,
  movementStatusLabels,
  movementStatusTone,
} from "@/components/treasury/movement-status";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getBankTransaction } from "@/server/treasury/service";
import { listTransactionAllocations } from "@/server/treasury/workbench";

export default async function BankTransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("treasury.read");
  const { id } = await params;
  const transaction = await getBankTransaction(ctx.company.id, id);
  if (!transaction) notFound();
  const allocations = transaction.reconciliationStatus === "RECONCILED" ? await listTransactionAllocations(ctx.company.id, transaction.id) : [];

  const isReconciled = transaction.reconciliationStatus === "RECONCILED";
  const statusKey = movementStatusKey(transaction.reconciliationStatus, transaction.resolution);
  const canWrite = can(ctx.membership.role, "treasury.write");
  const currency = ctx.company.baseCurrencyCode;
  const legacyMatch = transaction.matchedInvoicePaymentId
    ? "Cobro de cliente vinculado"
    : transaction.matchedSupplierPaymentId
      ? "Pago a proveedor vinculado"
      : null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Movimiento"
        title={transaction.description}
        description={`${transaction.bankName} · ${formatDate(transaction.postedAt)}${transaction.reference ? ` · Ref. ${transaction.reference}` : ""}`}
        backHref={`/treasury/bank-accounts/${transaction.bankAccountId}`}
        backLabel="Volver a la cuenta"
        meta={<StatusBadge tone={movementStatusTone(statusKey)}>{movementStatusLabels[statusKey]}</StatusBadge>}
        actions={canWrite ? <><ManualReconcileButton reconciled={isReconciled} transactionId={transaction.id} />{!isReconciled ? <><Link className={buttonVariants({ variant: "outline" })} href={`/treasury/bank-transactions/${transaction.id}/edit`}>Editar</Link><DeleteButton url={`/api/bank-transactions/${transaction.id}`} redirectTo={`/treasury/bank-accounts/${transaction.bankAccountId}`} /></> : null}</> : null}
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Importe" value={formatMoney(transaction.amount, currency)} helper={Number(transaction.amount) >= 0 ? "Entra dinero" : "Sale dinero"} tone={Number(transaction.amount) >= 0 ? "success" : "neutral"} />
        <MetricCard label="Fecha" value={formatDate(transaction.postedAt)} helper={transaction.valueDate ? `Fecha valor ${formatDate(transaction.valueDate)}` : transaction.iban} />
        <MetricCard label="Estado" value={movementStatusLabels[statusKey]} helper={transaction.reconciledAt ? `Desde el ${formatDateTime(transaction.reconciledAt)}` : "Concílialo en la mesa de conciliación"} tone={movementStatusTone(statusKey)} />
      </section>

      {!isReconciled ? <InlineAlert tone="warning" title="Pendiente de identificar">{PENDING_ACCOUNT_EXPLANATION}</InlineAlert> : null}

      <PageSection title="A qué corresponde" description={movementStatusDescriptions[statusKey]}>
        {allocations.length ? (
          <ul className="space-y-1 text-sm" data-testid="bank-transaction-allocations">
            {allocations.map((allocation) => (
              <li className="flex flex-wrap justify-between gap-2 border-b border-window-shadow py-1" key={allocation.id}>
                <span>
                  {allocation.kind === "ACCOUNT" ? (
                    <>Cuenta {allocation.accountCode} · {allocation.accountName}</>
                  ) : allocation.kind === "CUSTOMER_PAYMENT" ? (
                    <>Cobro {allocation.paymentNumber ?? ""} de la factura {allocation.invoiceId ? <Link className="text-primary hover:underline" href={`/invoices/${allocation.invoiceId}`}>{allocation.invoiceNumber}</Link> : "—"}</>
                  ) : (
                    <>Pago {allocation.supplierPaymentNumber ?? ""} de la factura {allocation.supplierInvoiceId ? <Link className="text-primary hover:underline" href={allocation.supplierInvoiceOrigin === "EXPENSE" ? `/expenses/${allocation.supplierInvoiceId}` : `/purchases/supplier-invoices?q=${encodeURIComponent(allocation.supplierInvoiceNumber ?? "")}`}>{allocation.supplierInvoiceNumber}</Link> : "—"}</>
                  )}
                  {allocation.createdPayment ? <span className="text-xs text-muted-foreground"> (registrado al conciliar)</span> : null}
                </span>
                <span className="font-mono">{formatMoney(allocation.amount, currency)}</span>
              </li>
            ))}
          </ul>
        ) : legacyMatch ? (
          <p className="text-sm">{legacyMatch}.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no está vinculado a nada. <Link className="text-primary underline" href={`/treasury/reconciliation?focus=${transaction.id}#movement-${transaction.id}`}>Conciliarlo ahora</Link>.</p>
        )}
      </PageSection>
    </PageShell>
  );
}
