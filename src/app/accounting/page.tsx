import Link from "next/link";

import { FiscalYearLifecyclePanel } from "@/components/accounting/fiscal-year-lifecycle-panel";
import { CompanyDefaultsPanel } from "@/components/company/company-defaults-panel";
import { buttonVariants } from "@/components/ui/button";
import {
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatBalance, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import {
  getTrialBalance,
  listAccounts,
  listJournalEntries,
} from "@/server/accounting/service";
import { getFiscalYearLifecycle } from "@/server/accounting/fiscal-years";
import { getCompanyDefaultsStatus } from "@/server/company/defaults";

const areas = [
  {
    href: "/accounting/accounts",
    title: "Plan contable",
    description: "Cuentas, saldos y libro mayor.",
  },
  {
    href: "/accounting/entries",
    title: "Asientos",
    description: "Libro diario y movimientos contables.",
  },
  {
    href: "/accounting/reports",
    title: "Estados financieros",
    description: "Balance, cuenta de resultados y sumas y saldos por periodo.",
  },
  {
    href: "/accounting/gestor",
    title: "Paquete para el gestor",
    description: "Libros, sumas y saldos, IVA y modelos en un ZIP.",
  },
  {
    href: "/fiscal/glossary",
    title: "Ayuda",
    description: "Glosario contable y fiscal en lenguaje llano.",
  },
];

export default async function AccountingPage() {
  const ctx = await requireContext("accounting.read");
  const [[balance], accounts, entries, defaultsStatus, lifecycle] = await Promise.all([
    getTrialBalance(ctx.company.id),
    listAccounts(ctx.company.id),
    listJournalEntries(ctx.company.id),
    getCompanyDefaultsStatus({
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      countryCode: ctx.company.countryCode,
    }),
    getFiscalYearLifecycle(ctx.company.id, ctx.fiscalYear.id),
  ]);
  const canWrite = can(ctx.membership.role, "accounting.write");
  const difference = Number(balance?.debit ?? 0) - Number(balance?.credit ?? 0);
  const currency = ctx.company.baseCurrencyCode;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Contabilidad"
        description="Libros, cuentas y estados financieros de la empresa activa."
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={canWrite ? <><Link className={buttonVariants({ variant: "outline" })} href="/accounting/accounts/new">Nueva cuenta</Link><Link className={buttonVariants()} href="/accounting/entries/new">Nuevo asiento</Link></> : null}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="Asientos"
          value={balance?.entries ?? 0}
          helper={`${accounts.filter((row) => row.isPostable).length} cuentas admiten apuntes`}
        />
        <MetricCard
          label="Debe"
          value={formatMoney(balance?.debit ?? 0, currency)}
          helper="Balance de comprobación"
        />
        <MetricCard
          label="Haber"
          value={formatMoney(balance?.credit ?? 0, currency)}
          helper="Balance de comprobación"
        />
        <MetricCard
          label={Math.abs(difference) < 0.005 ? "Cuadre" : "Descuadre"}
          value={Math.abs(difference) < 0.005 ? "Cuadrado" : formatMoney(difference, currency)}
          helper={
            Math.abs(difference) < 0.005
              ? "Debe y haber coinciden"
              : "Debe y haber no coinciden: revisa los asientos manuales"
          }
          tone={Math.abs(difference) < 0.005 ? "success" : "warning"}
        />
      </section>
      {lifecycle ? (
        <PageSection
          title="Ejercicio contable"
          description="Abre el ejercicio siguiente y cierra el actual para trasladar los saldos."
        >
          <FiscalYearLifecyclePanel canWrite={canWrite} lifecycle={{ ...lifecycle, companyId: ctx.company.id }} />
        </PageSection>
      ) : null}
      {!defaultsStatus.ready ? (
        <PageSection
          title="Configuración necesaria"
          description="Completa los ajustes contables antes de contabilizar documentos."
        >
          <CompanyDefaultsPanel
            canRepair={can(ctx.membership.role, "settings.manage")}
            compact
            initialStatus={defaultsStatus}
          />
        </PageSection>
      ) : null}
      <PageSection
        title="Áreas contables"
        description="Cada función dispone de su propio espacio de trabajo."
      >
        <div className="grid gap-px overflow-hidden border bg-border md:grid-cols-3 xl:grid-cols-5">
          {areas.map((area) => (
            <Link
              className="bg-background p-3 transition-colors hover:bg-muted/40"
              href={area.href}
              key={area.href}
            >
              <h3 className="font-semibold">{area.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {area.description}
              </p>
              <span className="mt-5 block text-sm font-medium text-link">
                Abrir
              </span>
            </Link>
          ))}
        </div>
      </PageSection>
      <PageSection
        title="Cuentas recientes"
        description="Acceso directo a las últimas cuentas activas del plan."
        actions={<Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/accounting/accounts">Ver plan completo</Link>}
      >
        <div className="divide-y border-y">
          {accounts.filter((account) => account.isActive).slice(0, 8).map((account) => <div className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_auto_auto]" key={account.id}><span className="font-medium">{account.code} · {account.name}</span><span className="text-sm text-muted-foreground">{formatBalance(account.balance, currency)}</span><Link className="text-sm font-medium text-link hover:underline" href={`/accounting/ledger/${account.id}`}>Ver mayor</Link></div>)}
        </div>
      </PageSection>
      <PageSection
        title="Actividad reciente"
        description="Últimos asientos del libro diario."
        actions={
          <Link
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href="/accounting/entries"
          >
            Ver todos
          </Link>
        }
      >
        <div className="divide-y border-y">
          {entries.slice(0, 5).map((entry) => (
            <Link
              className="grid gap-2 py-3 hover:bg-muted/30 sm:grid-cols-[1fr_120px_120px]"
              href={`/accounting/entries/${entry.id}`}
              key={entry.id}
            >
              <span><span className="block font-mono font-semibold">{entry.number}</span><span className="text-xs text-muted-foreground">{entry.reference || "Sin referencia"}</span></span>
              <span className="text-sm text-muted-foreground sm:text-right">
                Debe {formatMoney(entry.debit, currency)}
              </span>
              <span className="text-sm text-muted-foreground sm:text-right">
                Haber {formatMoney(entry.credit, currency)}
              </span>
            </Link>
          ))}
        </div>
      </PageSection>
    </PageShell>
  );
}
