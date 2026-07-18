import Link from "next/link";
import { notFound } from "next/navigation";

import { BankTransactionsList } from "@/components/treasury/bank-transactions-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getBankAccount, listBankTransactions } from "@/server/treasury/service";

export default async function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("treasury.read");
  const { id } = await params;
  const [account, transactions] = await Promise.all([getBankAccount(ctx.company.id, id), listBankTransactions(ctx.company.id, id)]);
  if (!account) notFound();

  const balance = transactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const income = transactions.reduce((sum, transaction) => sum + Math.max(Number(transaction.amount), 0), 0);
  const outflow = transactions.reduce((sum, transaction) => sum + Math.min(Number(transaction.amount), 0), 0);
  const pending = transactions.filter((transaction) => transaction.reconciliationStatus === "PENDING").length;
  const canWrite = can(ctx.membership.role, "treasury.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Cuenta"
        title={account.bankName}
        description={account.iban}
        backHref="/treasury"
        backLabel="Volver a tesorería"
        actions={canWrite ? <><Link className={buttonVariants({ variant: "outline" })} href={`/treasury/bank-accounts/${account.id}/edit`}>Editar</Link><Link className={buttonVariants()} href={`/treasury/bank-transactions/new?bankAccountId=${account.id}`}>Nuevo movimiento</Link></> : null}
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Saldo registrado" value={formatMoney(balance, ctx.company.baseCurrencyCode)} helper={`${transactions.length} movimientos`} tone={balance >= 0 ? "success" : "warning"} />
        <MetricCard label="Entradas" value={formatMoney(income, ctx.company.baseCurrencyCode)} helper="Cobros y abonos" />
        <MetricCard label="Salidas" value={formatMoney(Math.abs(outflow), ctx.company.baseCurrencyCode)} helper="Pagos y cargos" />
        <MetricCard label="Sin conciliar" value={pending} helper="Requieren revisión" tone={pending > 0 ? "warning" : "success"} />
      </section>

      <PageSection title="Movimientos de la cuenta" description="Histórico completo, búsqueda, vistas guardadas y exportación.">
        <BankTransactionsList accounts={[account]} canManage={canWrite} currencyCode={ctx.company.baseCurrencyCode} rows={transactions} />
      </PageSection>
    </PageShell>
  );
}
