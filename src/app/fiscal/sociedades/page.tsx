import type { Metadata } from "next";
import Link from "next/link";

import { CorporateTaxLossesForm, CorporateTaxRemindersForm } from "@/components/fiscal/corporate-tax-extras";
import { CorporateTaxReturnForm } from "@/components/fiscal/corporate-tax-return-form";
import { CorporateTaxNotAvailable, CorporateTaxYearNav } from "@/components/fiscal/corporate-tax-shared";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getCorporateTaxYear, getReminderSettings, isCorporateTaxCompany, listLossRegister } from "@/server/corporate-tax/service";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { formatIsoDate } from "@/server/fixed-assets/schedule";

export const metadata: Metadata = { title: "Impuesto sobre Sociedades" };

export default async function CorporateTaxPage({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  if (!(await isCorporateTaxCompany(ctx.company.id, ctx.company.countryCode))) return <CorporateTaxNotAvailable />;

  const params = await searchParams;
  const requested = typeof params.year === "string" ? params.year : null;
  const fiscalYearId = ctx.availableFiscalYears.find((year) => year.id === requested)?.id ?? ctx.fiscalYear.id;
  const [view, lossRegister, reminders] = await Promise.all([
    getCorporateTaxYear(ctx.company.id, fiscalYearId),
    listLossRegister(ctx.company.id),
    getReminderSettings(ctx.company.id),
  ]);
  const canWrite = can(ctx.membership.role, "fiscal.write");
  const canPost = can(ctx.membership.role, "accounting.write");
  const currency = ctx.company.baseCurrencyCode;
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const { result } = view;

  return (
    <PageShell>
      <PageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href={`/fiscal/sociedades/pagos-fraccionados?year=${encodeURIComponent(fiscalYearId)}`}>Pagos fraccionados (202)</Link>
            <Link className={buttonVariants({ variant: "outline" })} href={`/fiscal/sociedades/resumen?year=${encodeURIComponent(fiscalYearId)}`}>Resumen para Sociedades WEB</Link>
          </>
        }
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
        description={`Liquidación asistida del modelo 200. Ejercicio ${view.year.code}: del ${formatIsoDate(view.year.start)} al ${formatIsoDate(view.year.end)}.`}
        eyebrow="Fiscalidad"
        title="Impuesto sobre Sociedades"
      />
      <CorporateTaxYearNav basePath="/fiscal/sociedades" current={fiscalYearId} years={ctx.availableFiscalYears} />

      <section aria-label="Resumen de la liquidación" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard helper="Antes de impuestos, según el libro" label="Resultado contable" value={money(result.accountingResultBeforeTaxCents)} />
        <MetricCard helper="Tras ajustes y bases negativas" label="Base imponible" value={money(result.taxableBaseCents)} />
        <MetricCard helper="Impuesto del ejercicio" label="Cuota líquida" value={money(result.netQuotaCents)} />
        <MetricCard
          helper={result.outcome === "toRefund" ? "A devolver" : result.outcome === "toPay" ? "A ingresar" : "Sin ingreso ni devolución"}
          label="Cuota diferencial"
          tone={result.outcome === "toPay" ? "warning" : "success"}
          value={money(Math.abs(result.differentialCents))}
        />
      </section>

      <CorporateTaxReturnForm canPost={canPost} canWrite={canWrite} currencyCode={currency} initialView={view} key={`${fiscalYearId}-${view.status}`} />

      <PageSection description="Pérdidas fiscales de años anteriores que puedes restar de los beneficios de este y de los siguientes." title="Bases negativas de ejercicios anteriores">
        <CorporateTaxLossesForm canWrite={canWrite} currencyCode={currency} rows={lossRegister.rows} />
      </PageSection>

      <PageSection description="Otras obligaciones anuales de la sociedad que puedes ver en el calendario fiscal." id="recordatorios" title="Recordatorios">
        <CorporateTaxRemindersForm canWrite={canWrite} initial={reminders} />
      </PageSection>
    </PageShell>
  );
}
