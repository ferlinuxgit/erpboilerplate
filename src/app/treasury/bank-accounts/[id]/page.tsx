import Link from "next/link";
import { notFound } from "next/navigation";

import { BankTransactionsList } from "@/components/treasury/bank-transactions-list";
import { buttonVariants } from "@/components/ui/button";
import { BankAccountArchiveButton } from "@/components/treasury/bank-account-archive-button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { bankTransactionStats, recentBankTransactions } from "@/server/treasury/bank-transaction-list";
import { getCurrentBankBalances } from "@/server/treasury/forecast";
import { getBankAccount } from "@/server/treasury/service";

const RECENT_MOVEMENTS = 20;

export default async function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("treasury.read");
  const { id } = await params;
  const account = await getBankAccount(ctx.company.id, id);
  if (!account) notFound();
  // Totals in SQL and only the latest movements; the full history is the paginated list.
  const [stats, recent, balances] = await Promise.all([
    bankTransactionStats(ctx.company.id, { bankAccountId: account.id }),
    recentBankTransactions(ctx.company.id, { bankAccountId: account.id }, RECENT_MOVEMENTS),
    getCurrentBankBalances(ctx.company.id),
  ]);
  const { income, outflow, pending } = stats;
  const current = balances.find((entry) => entry.id === account.id);
  const balance = current?.balance ?? stats.balance;
  const balanceHelper = current?.source === "STATEMENT"
    ? `Según el extracto${current.asOf ? ` del ${formatDate(current.asOf)}` : ""}`
    : current?.source === "LEDGER" ? "Según la contabilidad (importa el extracto para ver el saldo del banco)" : `${stats.total} movimientos`;
  const allMovementsHref = `/treasury/bank-transactions?account=${encodeURIComponent(account.id)}`;
  const canWrite = can(ctx.membership.role, "treasury.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Cuenta"
        title={account.bankName}
        description={`${account.iban} · Cuenta contable ${account.accountCode ? `${account.accountCode} ${account.accountName ?? ""}` : "572 (por defecto)"}`}
        backHref="/treasury/bank-accounts"
        backLabel="Volver a cuentas bancarias"
        meta={<StatusBadge tone={account.isActive ? "success" : "neutral"}>{account.isActive ? "Activa" : "Archivada"}</StatusBadge>}
        actions={canWrite ? <><Link className={buttonVariants({ variant: "outline" })} href={`/treasury/bank-accounts/${account.id}/edit`}>Editar</Link><BankAccountArchiveButton accountId={account.id} bankName={account.bankName} isActive={account.isActive} />{account.isActive ? <><Link className={buttonVariants({ variant: "outline" })} href={`/treasury/bank-transactions/new?bankAccountId=${account.id}`}>Nuevo movimiento</Link><Link className={buttonVariants()} data-testid="bank-account-import" href={`/treasury/import?account=${encodeURIComponent(account.id)}`}>Importar extracto</Link></> : null}</> : null}
      />

      {!account.isActive ? (
        <InlineAlert tone="neutral">Cuenta archivada: conserva su historial y sus asientos, pero no admite movimientos nuevos. Reactívala si vuelves a usarla.</InlineAlert>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Saldo actual" value={formatMoney(balance, ctx.company.baseCurrencyCode)} helper={balanceHelper} tone={balance >= 0 ? "success" : "warning"} />
        <MetricCard label="Entradas" value={formatMoney(income, ctx.company.baseCurrencyCode)} helper="Cobros y abonos" />
        <MetricCard label="Salidas" value={formatMoney(Math.abs(outflow), ctx.company.baseCurrencyCode)} helper="Pagos y cargos" />
        <MetricCard href={pending > 0 ? `/treasury/reconciliation?account=${encodeURIComponent(account.id)}` : undefined} label="Pendientes de conciliar" value={pending} helper={pending > 0 ? "Abrir la conciliación" : "Todo identificado"} tone={pending > 0 ? "warning" : "success"} />
      </section>

      <PageSection
        title="Últimos movimientos"
        description={
          stats.total > recent.length
            ? `Los ${recent.length} movimientos más recientes de ${stats.total}. El histórico completo, con búsqueda y exportación, está en Movimientos bancarios.`
            : "Movimientos de la cuenta. Para buscar por fechas o exportar, abre el listado de movimientos bancarios."
        }
        actions={
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="bank-account-all-movements" href={allMovementsHref}>
            Ver todos los movimientos{stats.total > recent.length ? ` (${stats.total})` : ""}
          </Link>
        }
      >
        <BankTransactionsList accounts={[account]} canManage={canWrite} currencyCode={ctx.company.baseCurrencyCode} hiddenFilters={["account"]} rows={recent} />
      </PageSection>
    </PageShell>
  );
}
