import { BankTransactionsList } from "@/components/treasury/bank-transactions-list";
import { TreasuryOperations } from "@/components/treasury/treasury-operations";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
import { toServerListState } from "@/server/lists/paginate";
import {
  bankTransactionStats,
  bankTransactionSortKeys,
  listBankTransactionsPage,
} from "@/server/treasury/bank-transaction-list";
import { listBankAccounts } from "@/server/treasury/service";

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("treasury.read");
  const [accounts, stats, rawParams] = await Promise.all([
    listBankAccounts(ctx.company.id),
    bankTransactionStats(ctx.company.id),
    searchParams,
  ]);
  // Only pending movements, server-paginated (oldest first: they are the ones to clear first).
  // The reconciliation status is fixed by the page, so it is not a URL filter here.
  const params = parseListParams(rawParams, {
    sortKeys: bankTransactionSortKeys,
    defaultSort: { key: "postedAt", dir: "asc" },
    filters: { account: accounts.map((account) => account.id) },
  });
  const pendingPage = await listBankTransactionsPage(ctx.company.id, params, { reconciliationStatus: "PENDING" });
  const canManage = can(ctx.membership.role, "treasury.write");
  const activeAccounts = accounts.filter((account) => account.isActive);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Conciliación bancaria"
        description="Importa extractos y cruza cada movimiento con su cobro o pago. Mientras no se concilia, el movimiento queda en la cuenta 555 (pendiente de aplicación)."
        backHref="/treasury"
        backLabel="Volver al resumen"
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Pendientes"
          value={stats.pending}
          helper="Requieren revisión"
          tone={stats.pending > 0 ? "warning" : "success"}
        />
        <MetricCard
          label="Conciliados"
          value={stats.reconciled}
          helper="Movimientos vinculados"
        />
        <MetricCard
          label="Cobertura"
          value={
            stats.total
              ? `${Math.round((stats.reconciled / stats.total) * 100)}%`
              : "100%"
          }
          helper={`${stats.total} movimientos totales`}
        />
      </section>
      <PageSection
        title="Operaciones"
        description="Importación CSV y propuesta automática de conciliación."
      >
        {canManage && activeAccounts.length ? (
          <TreasuryOperations
            accounts={activeAccounts}
            pendingCount={stats.pending}
          />
        ) : (
          <EmptyState
            title={activeAccounts.length ? "Solo lectura" : "Sin cuentas bancarias activas"}
            description={
              activeAccounts.length
                ? "Tu rol no permite importar ni conciliar movimientos."
                : "Crea o reactiva una cuenta bancaria antes de importar un extracto."
            }
          />
        )}
      </PageSection>
      <PageSection
        title="Movimientos pendientes"
        description="Partidas que todavía no están vinculadas a un cobro o pago. Usa «Conciliar» para elegir su contrapartida."
      >
        <BankTransactionsList
          accounts={accounts}
          canManage={canManage}
          currencyCode={ctx.company.baseCurrencyCode}
          hiddenFilters={["reconciliation"]}
          rows={pendingPage.rows}
          server={toServerListState(params, pendingPage, pendingPage.unfilteredTotal)}
        />
      </PageSection>
    </PageShell>
  );
}
