import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { reconciliationStatusLabels, statusLabel } from "@/lib/status-labels";
import { getBankTransaction } from "@/server/treasury/service";
import { ManualReconcileButton } from "@/components/treasury/manual-reconcile-button";

export default async function BankTransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("treasury.read");
  const { id } = await params;
  const transaction = await getBankTransaction(ctx.company.id, id);
  if (!transaction) notFound();

  const isReconciled = transaction.reconciliationStatus === "RECONCILED";
  const canWrite = can(ctx.membership.role, "treasury.write");
  const matchLabel = transaction.matchedInvoicePaymentId
    ? `Cobro ${transaction.matchedInvoicePaymentId.slice(0, 8)}`
    : transaction.matchedSupplierPaymentId
      ? `Pago a proveedor ${transaction.matchedSupplierPaymentId.slice(0, 8)}`
      : "Sin contrapartida vinculada";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Movimiento"
        title={transaction.description}
        description={`${transaction.bankName} · ${formatDate(transaction.postedAt)}`}
        backHref={`/treasury/bank-accounts/${transaction.bankAccountId}`}
        backLabel="Volver a la cuenta"
        meta={<StatusBadge tone={isReconciled ? "success" : "warning"}>{statusLabel(reconciliationStatusLabels, transaction.reconciliationStatus)}</StatusBadge>}
        actions={canWrite ? <><ManualReconcileButton currencyCode={ctx.company.baseCurrencyCode} reconciled={isReconciled} transactionId={transaction.id} />{!isReconciled ? <><Link className={buttonVariants({ variant: "outline" })} href={`/treasury/bank-transactions/${transaction.id}/edit`}>Editar</Link><DeleteButton url={`/api/bank-transactions/${transaction.id}`} redirectTo={`/treasury/bank-accounts/${transaction.bankAccountId}`} /></> : null}</> : null}
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Importe" value={formatMoney(transaction.amount, ctx.company.baseCurrencyCode)} helper={Number(transaction.amount) >= 0 ? "Entrada bancaria" : "Salida bancaria"} tone={Number(transaction.amount) >= 0 ? "success" : "neutral"} />
        <MetricCard label="Fecha contable" value={formatDate(transaction.postedAt)} helper={transaction.iban} />
        <MetricCard label="Conciliación" value={isReconciled ? "Completada" : "Pendiente"} helper={transaction.reconciledAt ? formatDateTime(transaction.reconciledAt) : "Ejecuta la conciliación desde Tesorería"} tone={isReconciled ? "success" : "warning"} />
      </section>

      <PageSection title="Trazabilidad" description="Relación entre el apunte bancario y la operación registrada." contentClassName="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[2px] border p-3"><p className="text-sm text-muted-foreground">Cuenta bancaria</p><Link className="mt-1 block font-medium text-primary hover:underline" href={`/treasury/bank-accounts/${transaction.bankAccountId}`}>{transaction.bankName}</Link><p className="mt-1 break-all text-sm text-muted-foreground">{transaction.iban}</p></div>
        <div className="rounded-[2px] border p-3"><p className="text-sm text-muted-foreground">Contrapartida</p><p className="mt-1 font-medium">{matchLabel}</p><p className="mt-1 text-sm text-muted-foreground">{isReconciled ? "Coincidencia validada por el motor de conciliación." : "Aún no existe una coincidencia confirmada."}</p></div>
      </PageSection>
    </PageShell>
  );
}
