import Link from "next/link";

import { ReconciliationWorkbench } from "@/components/treasury/reconciliation-workbench";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import type { RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
import { bankTransactionStats } from "@/server/treasury/bank-transaction-list";
import { listBankAccounts } from "@/server/treasury/service";
import { getReconciliationWorkbench, listAssignableAccounts } from "@/server/treasury/workbench";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("treasury.read");
  const rawParams = await searchParams;
  const accounts = await listBankAccounts(ctx.company.id);
  const requestedAccount = firstParam(rawParams.account);
  const bankAccountId = accounts.some((account) => account.id === requestedAccount) ? requestedAccount : undefined;
  const focusId = firstParam(rawParams.focus) ?? null;
  const [stats, workbench, assignable] = await Promise.all([
    bankTransactionStats(ctx.company.id, { bankAccountId }),
    getReconciliationWorkbench(ctx.company.id, { bankAccountId }),
    listAssignableAccounts(ctx.company.id),
  ]);
  const canWrite = can(ctx.membership.role, "treasury.write");
  const currency = ctx.company.baseCurrencyCode;
  const safeCount = workbench.movements.filter((movement) => movement.suggestions[0]?.safe).length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Conciliación bancaria"
        description="Di a qué corresponde cada movimiento del banco: te proponemos el cobro, el pago, las facturas o la cuenta. Tú decides; todo se puede deshacer."
        backHref="/treasury"
        backLabel="Volver al resumen"
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Pendientes de conciliar" value={stats.pending} helper={`${formatMoney(stats.pendingAmount, currency)} pendientes de identificar`} tone={stats.pending > 0 ? "warning" : "success"} />
        <MetricCard label="Con propuesta segura" value={safeCount} helper="Se pueden aceptar de golpe" tone={safeCount > 0 ? "success" : "neutral"} />
        <MetricCard label="Conciliados" value={stats.reconciled - stats.assigned} helper="Vinculados a cobros o pagos" />
        <MetricCard label="Asignados a cuenta" value={stats.assigned} helper="Comisiones, cuotas, impuestos…" />
      </section>

      {accounts.length > 1 ? (
        <nav aria-label="Filtrar por cuenta" className="flex flex-wrap gap-1">
          <Link aria-current={!bankAccountId ? "page" : undefined} className={buttonVariants({ size: "sm", variant: !bankAccountId ? "default" : "outline" })} href="/treasury/reconciliation">Todas las cuentas</Link>
          {accounts.map((account) => (
            <Link
              aria-current={bankAccountId === account.id ? "page" : undefined}
              className={buttonVariants({ size: "sm", variant: bankAccountId === account.id ? "default" : "outline" })}
              href={`/treasury/reconciliation?account=${encodeURIComponent(account.id)}`}
              key={account.id}
            >
              {account.bankName}
            </Link>
          ))}
        </nav>
      ) : null}

      <PageSection title="Movimientos por conciliar" description="Del más antiguo al más reciente.">
        {accounts.length === 0 ? (
          <EmptyState
            title="Sin cuentas bancarias"
            description="Crea tu cuenta bancaria y después importa el extracto para empezar a conciliar."
            action={<Link className={buttonVariants({ size: "sm" })} href="/treasury/bank-accounts/new">Crear cuenta bancaria</Link>}
          />
        ) : (
          <ReconciliationWorkbench
            accounts={assignable}
            canWrite={canWrite}
            currencyCode={currency}
            customerInvoices={workbench.customerInvoices}
            focusId={focusId}
            movements={workbench.movements}
            supplierInvoices={workbench.supplierInvoices}
            truncated={workbench.movements.length >= 100}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
