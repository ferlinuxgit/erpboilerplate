import Link from "next/link";

import { PayrollMonthPanel } from "@/components/payroll/payroll-month-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { isPayrollPeriod, periodLabel } from "@/server/payroll/model";
import { getPeriodSummary, listEmployees, listPayrollBankOptions, listPayrollPeriods, listSlips } from "@/server/payroll/service";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const query = await searchParams;
  const today = dateInputValue(new Date(), ctx.company.timezone);
  const requested = Array.isArray(query.period) ? query.period[0] : query.period;
  const periods = await listPayrollPeriods(ctx.company.id);
  const period = isPayrollPeriod(requested) ? requested : periods[0]?.period ?? today.slice(0, 7);
  const [slips, summary, banks, employees] = await Promise.all([
    listSlips(ctx.company.id, { period }),
    getPeriodSummary(ctx.company.id, period),
    listPayrollBankOptions(ctx.company.id),
    listEmployees(ctx.company.id),
  ]);
  const canWrite = can(ctx.membership.role, "accounting.write");
  const currency = ctx.company.baseCurrencyCode;
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const hasEmployees = employees.length > 0;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Nóminas y retenciones"
        title={`Nóminas de ${periodLabel(period)}`}
        description="Anota las nóminas que te prepara la gestoría, contabilízalas y registra su pago. De aquí salen los modelos 111 y 190."
        actions={
          canWrite && hasEmployees ? (
            <>
              <Link className={buttonVariants({ variant: "outline" })} href={`/payroll/import?period=${period}`}>Importar nóminas</Link>
              <Link className={buttonVariants()} href={`/payroll/slips/new?period=${period}`}>Nueva nómina</Link>
            </>
          ) : undefined
        }
      />

      <form action="/payroll" className="flex flex-wrap items-end gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-2.5" data-ignore-dirty-guard="true" method="get">
        <div className="space-y-1">
          <Label htmlFor="payroll-period">Mes</Label>
          <Input className="w-44" defaultValue={period} id="payroll-period" name="period" type="month" />
        </div>
        <Button type="submit" variant="secondary">Ver mes</Button>
        {periods.slice(0, 6).map((entry) => (
          <Link className={buttonVariants({ variant: entry.period === period ? "default" : "ghost", size: "sm" })} href={`/payroll?period=${entry.period}`} key={entry.period}>
            {entry.label}{entry.drafts > 0 ? ` (${entry.drafts} en borrador)` : ""}
          </Link>
        ))}
      </form>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Coste del mes" value={money(summary.grossCents + summary.employerSocialSecurityCents)} helper="Sueldos brutos más Seguridad Social de la empresa" />
        <MetricCard label="IRPF retenido" value={money(summary.withholdingCents)} helper="Se ingresa con el modelo 111" />
        <MetricCard
          label="Nóminas por pagar"
          value={money(summary.pendingSalariesCents)}
          helper={summary.drafts > 0 ? `${summary.drafts} nómina(s) en borrador sin contabilizar` : "Líquido contabilizado pendiente de pago (465)"}
          tone={summary.pendingSalariesCents > 0 || summary.drafts > 0 ? "warning" : "success"}
        />
        <MetricCard label="Seguros sociales por pagar" value={money(summary.pendingSocialSecurityCents)} helper="Cuota del trabajador más la de la empresa (476)" tone={summary.pendingSocialSecurityCents > 0 ? "warning" : "success"} />
      </section>

      <PageSection title="Nóminas del mes" description="Cada nómina genera su asiento: sueldos (640) y Seguridad Social de la empresa (642) contra retenciones (4751), Seguridad Social (476) y líquido a pagar (465).">
        {!hasEmployees ? (
          <EmptyState
            title="Primero da de alta a tus trabajadores"
            description="Crea la ficha de cada empleado o administrador con su NIF y su tipo de retención. Después podrás anotar sus nóminas."
            action={canWrite ? <Link className={buttonVariants()} href="/payroll/employees/new">Nuevo trabajador</Link> : undefined}
          />
        ) : slips.length === 0 ? (
          <EmptyState
            title={`No hay nóminas en ${periodLabel(period)}`}
            description="Anótalas una a una con los importes del recibo de salarios, o pega la hoja de cálculo de la gestoría con todas."
            action={canWrite ? <Link className={buttonVariants()} href={`/payroll/slips/new?period=${period}`}>Nueva nómina</Link> : undefined}
          />
        ) : (
          <PayrollMonthPanel banks={banks} canWrite={canWrite} currencyCode={currency} period={period} slips={slips} summary={summary} today={today} />
        )}
      </PageSection>
    </PageShell>
  );
}
