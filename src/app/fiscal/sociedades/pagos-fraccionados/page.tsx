import type { Metadata } from "next";
import Link from "next/link";

import { CorporateTaxInstallmentCard } from "@/components/fiscal/corporate-tax-installment-card";
import { CorporateTaxNotAvailable, CorporateTaxYearNav } from "@/components/fiscal/corporate-tax-shared";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { dateInputValue } from "@/lib/date-input";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { CORPORATE_TAX_REGIME_LABELS } from "@/server/corporate-tax/rates";
import { getInstallments, isCorporateTaxCompany } from "@/server/corporate-tax/service";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";

export const metadata: Metadata = { title: "Pagos fraccionados de Sociedades" };

export default async function CorporateTaxInstallmentsPage({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  if (!(await isCorporateTaxCompany(ctx.company.id, ctx.company.countryCode))) return <CorporateTaxNotAvailable />;

  const params = await searchParams;
  const requested = typeof params.year === "string" ? params.year : null;
  const fiscalYearId = ctx.availableFiscalYears.find((year) => year.id === requested)?.id ?? ctx.fiscalYear.id;
  const view = await getInstallments(ctx.company.id, fiscalYearId);
  const currency = ctx.company.baseCurrencyCode;
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const paid = view.periods.reduce((sum, period) => sum + (period.payment?.amountCents ?? 0), 0);
  const calculated = view.periods.reduce((sum, period) => sum + period.amountCents, 0);

  return (
    <PageShell>
      <PageHeader
        actions={<Link className={buttonVariants({ variant: "outline" })} href={`/fiscal/sociedades?year=${encodeURIComponent(fiscalYearId)}`}>Liquidación del ejercicio (200)</Link>}
        backHref="/fiscal/sociedades"
        backLabel="Volver a Sociedades"
        description={`Modelo 202 del ejercicio ${view.year.code}: adelantos del impuesto en abril, octubre y diciembre.`}
        eyebrow="Fiscalidad · Impuesto sobre Sociedades"
        title="Pagos fraccionados"
      />
      <CorporateTaxYearNav basePath="/fiscal/sociedades/pagos-fraccionados" current={fiscalYearId} years={ctx.availableFiscalYears} />

      <InlineAlert title="El modelo 202 se presenta en la sede de la AEAT" tone="info">
        El programa calcula el importe de cada periodo y contabiliza su pago; no presenta el modelo ni genera su fichero. Los números entre corchetes son las casillas del formulario del 202.
        {" "}Hay dos formas de calcularlo: sobre la cuota del último ejercicio declarado (la habitual en una pyme) o sobre el beneficio que llevas este año (obligatoria si facturas más de 6 millones, o si la elegiste en el modelo 036).
      </InlineAlert>
      {view.warnings.length > 0 ? (
        <InlineAlert tone="warning">
          <ul className="list-disc space-y-1 pl-4">
            {view.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
          </ul>
        </InlineAlert>
      ) : null}

      <section aria-label="Resumen de los pagos fraccionados" className="grid gap-3 sm:grid-cols-3">
        <MetricCard helper={`Tipo de la liquidación de ${view.year.code}`} label="Tipo de gravamen" value={CORPORATE_TAX_REGIME_LABELS[view.regime].split(" (")[0]} />
        <MetricCard helper="Suma de los tres periodos" label="Calculado" value={money(calculated)} />
        <MetricCard helper="Pagos contabilizados en la cuenta 473" label="Pagado" value={money(paid)} />
      </section>

      {view.periods.map((period) => (
        <CorporateTaxInstallmentCard
          bankAccounts={view.bankAccounts}
          canPost={can(ctx.membership.role, "accounting.write")}
          canWrite={can(ctx.membership.role, "fiscal.write")}
          currencyCode={currency}
          fiscalYearId={fiscalYearId}
          initial={period}
          key={`${fiscalYearId}-${period.period}-${period.status}-${period.amountCents}-${period.payment?.journalEntryId ?? ""}-${period.facts.previousInstallmentsCents}`}
          methodLocked={view.baseMethodMandatory}
          today={dateInputValue(new Date(), ctx.company.timezone)}
          yearClosed={view.year.isClosed}
        />
      ))}
    </PageShell>
  );
}
