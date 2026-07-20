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
import { can } from "@/lib/rbac";
import {
  listBankAccounts,
  listBankTransactions,
} from "@/server/treasury/service";

export default async function ReconciliationPage() {
  const ctx = await requireContext("treasury.read");
  const [accounts, rows] = await Promise.all([
    listBankAccounts(ctx.company.id),
    listBankTransactions(ctx.company.id),
  ]);
  const pending = rows.filter((row) => row.reconciliationStatus === "PENDING");
  const reconciled = rows.length - pending.length;
  const canManage = can(ctx.membership.role, "treasury.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Conciliación bancaria"
        description="Importa extractos y cruza movimientos con cobros y pagos registrados."
        backHref="/treasury"
        backLabel="Volver al resumen"
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Pendientes"
          value={pending.length}
          helper="Requieren revisión"
          tone={pending.length > 0 ? "warning" : "success"}
        />
        <MetricCard
          label="Conciliados"
          value={reconciled}
          helper="Movimientos vinculados"
        />
        <MetricCard
          label="Cobertura"
          value={
            rows.length
              ? `${Math.round((reconciled / rows.length) * 100)}%`
              : "100%"
          }
          helper={`${rows.length} movimientos totales`}
        />
      </section>
      <PageSection
        title="Operaciones"
        description="Importación CSV y propuesta automática de conciliación."
      >
        {canManage && accounts.length ? (
          <TreasuryOperations
            accounts={accounts}
            pendingCount={pending.length}
          />
        ) : (
          <EmptyState
            title={accounts.length ? "Solo lectura" : "Sin cuentas bancarias"}
            description={
              accounts.length
                ? "Tu rol no permite importar ni conciliar movimientos."
                : "Crea una cuenta bancaria antes de importar un extracto."
            }
          />
        )}
      </PageSection>
      <PageSection
        title="Movimientos pendientes"
        description="Partidas que todavía no están vinculadas a un cobro o pago."
      >
        <BankTransactionsList
          accounts={accounts}
          canManage={canManage}
          currencyCode={ctx.company.baseCurrencyCode}
          rows={pending}
        />
      </PageSection>
    </PageShell>
  );
}
