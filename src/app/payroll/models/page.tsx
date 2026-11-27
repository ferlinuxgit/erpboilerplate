import Link from "next/link";

import { WithholdingModelView } from "@/components/payroll/withholding-model-view";
import { WithholdingSettingsForm } from "@/components/payroll/withholding-settings-form";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { composeFiscalPeriod, fiscalPeriodPartsFor, fiscalTimeZoneFor, getSpanishFiscalDueDate, getSpanishFiscalModel } from "@/lib/fiscal-spain";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { isWithholdingModelCode, WITHHOLDING_MODEL_CODES, type WithholdingModelCode } from "@/server/fiscal/withholdings";
import { getPayrollSettings, loadWithholdingModel } from "@/server/payroll/withholding-data";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function WithholdingModelsPage({ searchParams }: { searchParams: Promise<{ code?: string | string[]; year?: string | string[]; part?: string | string[] }> }) {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const query = await searchParams;
  const now = new Date();
  const requestedCode = first(query.code) ?? "";
  const code: WithholdingModelCode = isWithholdingModelCode(requestedCode) ? requestedCode : "111";
  const model = getSpanishFiscalModel(code);
  const parts = fiscalPeriodPartsFor(code);
  const requestedYear = Number(first(query.year));
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= now.getFullYear() + 1 ? requestedYear : now.getFullYear();
  const defaultPart = `Q${Math.floor(now.getMonth() / 3) + 1}`;
  const requestedPart = first(query.part);
  const part = parts.length === 0 ? null : parts.some((option) => option.value === requestedPart) ? requestedPart ?? defaultPart : defaultPart;
  const period = composeFiscalPeriod(year, part);
  const timeZone = fiscalTimeZoneFor(await getCompanyTaxTerritory(ctx.company.id));
  const [data, settings] = await Promise.all([loadWithholdingModel(ctx.company.id, code, period, timeZone), getPayrollSettings(ctx.company.id)]);
  const currency = ctx.company.baseCurrencyCode;
  const money = (cents: number) => formatMoney(cents / 100, currency);
  const dueDate = getSpanishFiscalDueDate(period, code);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Nóminas y retenciones"
        title="Modelos de retenciones"
        description="Cálculo en vivo de las autoliquidaciones (111, 115, 123) y de sus resúmenes anuales (190, 180, 193). Para guardarlos como borrador o marcarlos como presentados, créalos en Fiscalidad."
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/fiscal">Ir a Fiscalidad</Link>}
      />

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Modelo</span>
          <select className="h-9 rounded-control border bg-background px-2 text-sm" defaultValue={code} name="code">
            {WITHHOLDING_MODEL_CODES.map((option) => (
              <option key={option} value={option}>{option} · {getSpanishFiscalModel(option)?.shortName}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Año</span>
          <input className="h-9 w-24 rounded-control border bg-background px-2 font-mono text-sm" defaultValue={year} max={now.getFullYear() + 1} min={2000} name="year" type="number" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Periodo</span>
          <select className="h-9 rounded-control border bg-background px-2 text-sm" defaultValue={part ?? defaultPart} name="part">
            {[1, 2, 3, 4].map((quarter) => <option key={quarter} value={`Q${quarter}`}>{quarter}.º trimestre</option>)}
            {fiscalPeriodPartsFor("111").filter((option) => !option.value.startsWith("Q")).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button className={buttonVariants()} type="submit">Calcular</button>
        <p className="basis-full text-xs text-muted-foreground">Los resúmenes anuales (190, 180 y 193) son del año completo: el periodo no se tiene en cuenta.</p>
      </form>

      {data ? (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard label={`${model?.name ?? code} · ${period}`} value={model?.shortName ?? ""} helper={model?.plainHelp} />
            <MetricCard label="Base" value={money(data.summary.baseCents)} helper="Percepciones íntegras del periodo" />
            <MetricCard label="Retenciones" value={money(data.summary.withheldCents)} helper="Retenciones e ingresos a cuenta" />
            <MetricCard
              label={data.summary.resultCents === null ? "Declaración informativa" : "A ingresar"}
              value={data.summary.resultCents === null ? "No se paga" : money(data.summary.resultCents)}
              helper={dueDate ? `Plazo: hasta el ${formatDate(dueDate)}` : undefined}
              tone={data.summary.resultCents !== null && data.summary.resultCents > 0 ? "warning" : "neutral"}
            />
          </section>
          <WithholdingModelView currencyCode={currency} items={data.items} model={data.summary} showChecks />
        </>
      ) : (
        <InlineAlert tone="danger">Ese periodo no es válido para el modelo {code}.</InlineAlert>
      )}

      <PageSection title="Ajustes de retenciones" description="Cómo se reparten las retenciones entre periodos y qué modelos quieres ver en el calendario fiscal.">
        <WithholdingSettingsForm canWrite={can(ctx.membership.role, "fiscal.write")} initialValues={settings} />
      </PageSection>
    </PageShell>
  );
}
