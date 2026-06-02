import Link from "next/link";

import { AccountingMastersForm } from "@/components/accounting/accounting-masters-form";
import { AccountRowActions } from "@/components/accounting/account-row-actions";
import { CreateAccountForm } from "@/components/accounting/create-account-form";
import { CreateJournalEntryForm } from "@/components/accounting/create-journal-entry-form";
import { JournalEntryRowActions } from "@/components/accounting/journal-entry-row-actions";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { ensureUserTenant } from "@/lib/tenant";
import { getAccountingMasterStatus } from "@/server/accounting/masters";
import { getTrialBalance, listAccounts, listJournalEntries } from "@/server/accounting/service";

export default async function AccountingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const [balance] = await getTrialBalance(ctx.company.id);
  const accounts = await listAccounts(ctx.company.id);
  const entries = await listJournalEntries(ctx.company.id);
  const masterStatus = await getAccountingMasterStatus(ctx.company.id);
  const hasMissingMasters = masterStatus.missingAccounts.length > 0 || masterStatus.missingJournals.length > 0;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Contabilidad"
        description="Plan contable, asientos, libro mayor y balance de comprobación de la empresa activa."
        backHref="/dashboard"
        backLabel="Volver al panel"
      />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Asientos" value={balance?.entries ?? 0} helper="Movimientos contabilizados" />
        <MetricCard label="Debe" value={balance?.debit ?? "0"} helper="Balance de comprobación" />
        <MetricCard label="Haber" value={balance?.credit ?? "0"} helper="Balance de comprobación" />
      </section>

      {hasMissingMasters ? (
        <PageSection
          title="Maestros contables necesarios"
          description="Completa la configuración mínima antes de emitir facturas o contabilizar cobros."
        >
          <AccountingMastersForm missingAccounts={masterStatus.missingAccounts} missingJournals={masterStatus.missingJournals} />
        </PageSection>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <PageSection title="Nueva cuenta" description="Añade cuentas al plan contable activo.">
          <CreateAccountForm />
        </PageSection>
        <PageSection title="Nuevo asiento" description="Registra apuntes contables cuando ya exista al menos una cuenta.">
          {accounts.length > 0 ? (
            <CreateJournalEntryForm accounts={accounts.map((account) => ({ id: account.id, code: account.code, name: account.name }))} />
          ) : (
            <EmptyState title="Sin cuentas contables" description="Crea una cuenta antes de registrar asientos." />
          )}
        </PageSection>
      </section>

      <PageSection
        title="Plan contable"
        description="Cuentas disponibles y acceso directo al libro mayor."
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver al panel
          </Link>
        }
        contentClassName="space-y-2"
      >
        {accounts.length === 0 ? (
          <EmptyState title="Plan contable vacío" description="Añade la primera cuenta para empezar a registrar asientos." />
        ) : (
          accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {account.code} - {account.name}
                </p>
                <p className="text-sm text-muted-foreground">{account.type}</p>
                <Link className="text-sm text-primary underline-offset-4 hover:underline" href={`/accounting/ledger/${account.id}`}>
                  Ver mayor
                </Link>
              </div>
              <AccountRowActions id={account.id} />
            </div>
          ))
        )}
      </PageSection>

      <PageSection title="Asientos" description="Últimos asientos registrados." contentClassName="space-y-2">
        {entries.length === 0 ? (
          <EmptyState title="Sin asientos" description="Registra el primer asiento para alimentar el balance." />
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <p className="min-w-0 truncate text-sm">
                <span className="font-medium">{entry.postedAt.toISOString().slice(0, 10)}</span> - {entry.reference ?? "Sin referencia"} - {entry.debit}/{entry.credit}
              </p>
              <JournalEntryRowActions id={entry.id} />
            </div>
          ))
        )}
      </PageSection>
    </PageShell>
  );
}
