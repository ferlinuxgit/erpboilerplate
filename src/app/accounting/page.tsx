import Link from "next/link";

import { AccountsList } from "@/components/accounting/accounts-list";
import { CreateAccountDialog } from "@/components/accounting/account-dialogs";
import { JournalEntryRowActions } from "@/components/accounting/journal-entry-row-actions";
import { CompanyDefaultsPanel } from "@/components/company/company-defaults-panel";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getTrialBalance, listAccounts, listJournalEntries } from "@/server/accounting/service";
import { getCompanyDefaultsStatus } from "@/server/company/defaults";

export default async function AccountingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const [balance] = await getTrialBalance(ctx.company.id);
  const accounts = await listAccounts(ctx.company.id);
  const entries = await listJournalEntries(ctx.company.id);
  const canWriteAccounting = can(ctx.membership.role, "accounting.write");
  const activeAccounts = accounts.filter((account) => account.isActive).length;
  const postableAccounts = accounts.filter((account) => account.isPostable).length;
  const defaultsStatus = await getCompanyDefaultsStatus({
    companyId: ctx.company.id,
    fiscalYearId: ctx.fiscalYear.id,
    countryCode: ctx.company.countryCode,
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Contabilidad"
        description={`Plan general contable completo: ${accounts.length} cuentas, ${postableAccounts} postables y ${activeAccounts} activas por uso o saldo.`}
        backHref="/dashboard"
        backLabel="Volver al panel"
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Asientos" value={balance?.entries ?? 0} helper="Movimientos contabilizados" />
        <MetricCard label="Debe" value={balance?.debit ?? "0"} helper="Balance de comprobación" />
        <MetricCard label="Haber" value={balance?.credit ?? "0"} helper="Balance de comprobación" />
      </section>

      {!defaultsStatus.ready ? (
        <PageSection title="Configuración necesaria" description="La empresa necesita completar ajustes antes de operar con normalidad.">
          <CompanyDefaultsPanel
            canRepair={can(ctx.membership.role, "settings.manage")}
            compact
            initialStatus={defaultsStatus}
          />
        </PageSection>
      ) : null}

      <PageSection
        title="Plan contable"
        description="Cuentas disponibles y acceso directo al libro mayor."
        actions={
          canWriteAccounting ? (
            <CreateAccountDialog />
          ) : null
        }
        contentClassName="space-y-2"
      >
        {accounts.length === 0 ? (
          <EmptyState title="Plan contable vacío" description="Carga la plantilla contable o añade la primera cuenta para empezar a registrar asientos." />
        ) : (
          <AccountsList canManage={canWriteAccounting} rows={accounts} />
        )}
      </PageSection>

      <PageSection
        title="Asientos"
        description="Últimos asientos registrados."
        actions={
          canWriteAccounting ? (
            <Link className={buttonVariants()} href="/accounting/entries/new">
              Nuevo asiento
            </Link>
          ) : null
        }
        contentClassName="space-y-2"
      >
        {entries.length === 0 ? (
          <EmptyState title="Sin asientos" description="Registra el primer asiento para alimentar el balance." />
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <p className="min-w-0 truncate text-sm">
                <span className="font-medium">{entry.postedAt.toISOString().slice(0, 10)}</span> - {entry.reference ?? "Sin referencia"} - {entry.debit}/{entry.credit}
              </p>
              {canWriteAccounting ? <JournalEntryRowActions id={entry.id} /> : null}
            </div>
          ))
        )}
      </PageSection>
    </PageShell>
  );
}
