import Link from "next/link";

import { FiscalYearLifecyclePanel } from "@/components/accounting/fiscal-year-lifecycle-panel";
import { FiscalObligationsCard } from "@/components/fiscal/fiscal-obligations-card";
import { FiscalPositionSummary } from "@/components/fiscal/fiscal-position-summary";
import { FiscalReportsList } from "@/components/fiscal/fiscal-reports-list";
import { GenericTaxSummary } from "@/components/fiscal/generic-tax-summary";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCountryFiscalProfile, type CountryFiscalProfile } from "@/lib/country-packs/profile";
import { requireContext } from "@/lib/current-context";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { can } from "@/lib/rbac";
import { canFromDb } from "@/lib/rbac-server";
import { getFiscalYearLifecycle } from "@/server/accounting/fiscal-years";
import { getCurrentFiscalObligations } from "@/server/fiscal/obligations";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";
import { getFiscalSettings } from "@/server/fiscal/settings";
import { calculateTaxSummary, parseTaxSummaryPeriod, recentTaxSummaryPeriods } from "@/server/fiscal/tax-summary";

export default async function FiscalPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const ctx = await requireContext("fiscal.read");
  const country = getCountryFiscalProfile(ctx.company.countryCode);
  if (!country.features.taxReports) {
    const query = await searchParams;
    return <GenericFiscalPage companyId={ctx.company.id} country={country} currencyCode={ctx.company.baseCurrencyCode} period={Array.isArray(query.period) ? query.period[0] : query.period} />;
  }
  const [reports, canWrite, lifecycle, settings, territory, query] = await Promise.all([
    listFiscalReportsWithSummary(ctx.company.id),
    canFromDb(ctx.membership.role, "fiscal.write"),
    getFiscalYearLifecycle(ctx.company.id, ctx.fiscalYear.id),
    getFiscalSettings(ctx.company.id),
    getCompanyTaxTerritory(ctx.company.id),
    searchParams,
  ]);
  const obligations = await getCurrentFiscalObligations(ctx.company.id, reports);
  // Canarias (IGIC), Ceuta y Melilla (IPSI): modelos estatales + resumen de su impuesto indirecto.
  const territoryProfile = getCountryFiscalProfile(territory);
  const indirectSummary = territoryProfile.features.vatReturns
    ? null
    : await (async () => {
        const periods = recentTaxSummaryPeriods(new Date(), settings.taxPeriodicity);
        const selected = parseTaxSummaryPeriod(Array.isArray(query.period) ? query.period[0] : query.period) ?? periods[0];
        return { periods, summary: await calculateTaxSummary(ctx.company.id, selected, territory) };
      })();
  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title={territoryProfile.features.vatReturns ? "Fiscalidad España" : `Fiscalidad ${territoryProfile.territoryName}`}
        description={territoryProfile.features.vatReturns
          ? "Qué tienes que presentar y cuándo, con los importes calculados desde tus facturas. Modelos 303, 390, 347, 349, 111, 115 y 130, y registro VERI*FACTU."
          : `Qué tienes que presentar y cuándo: modelos estatales 111, 115, 130 y 347, registro VERI*FACTU y el resumen de tu ${territoryProfile.taxLabel} por periodo.`}
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={
          <StatusBadge tone={canWrite ? "success" : "warning"}>
            {canWrite ? "Gestión habilitada" : "Solo lectura"}
          </StatusBadge>
        }
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/calendar">
              Calendario
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/accounting/gestor">
              Paquete para el gestor
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/verifactu">
              VERI*FACTU
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/settings/fiscal">
              Configuración
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/fiscal/glossary">
              Ayuda
            </Link>
            {canWrite ? (
              <Link className={buttonVariants()} href="/fiscal/new">
                Nuevo modelo
              </Link>
            ) : null}
          </>
        }
      />
      {lifecycle ? (
        <FiscalYearLifecyclePanel canWrite={can(ctx.membership.role, "accounting.write")} lifecycle={{ ...lifecycle, companyId: ctx.company.id }} variant="alert" />
      ) : null}
      {indirectSummary ? (
        <PageSection
          title={`Resumen de ${territoryProfile.taxLabel}`}
          description={territoryProfile.taxLabel === "IGIC"
            ? "IGIC repercutido menos deducible del periodo, para el modelo 420 de la Agencia Tributaria Canaria (los modelos del IGIC aún no se generan aquí)."
            : `IPSI del periodo, para la autoliquidación ante la ciudad de ${territoryProfile.territoryName} (aún no se genera aquí).`}
        >
          <GenericTaxSummary country={territoryProfile} currencyCode={ctx.company.baseCurrencyCode} periods={indirectSummary.periods} summary={indirectSummary.summary} />
        </PageSection>
      ) : null}
      <PageSection
        title="Qué tengo que presentar"
        description="Según tu perfil fiscal y las facturas del periodo. Los importes son borradores: revísalos antes de presentarlos en la sede de la AEAT."
      >
        <FiscalObligationsCard canWrite={canWrite} obligations={obligations} />
      </PageSection>
      <PageSection
        title="Posición fiscal"
        description="Último modelo calculado desde tus facturas. Ábrelo para ver las casillas y copiarlas en la AEAT."
      >
        <FiscalPositionSummary currencyCode={ctx.company.baseCurrencyCode} profile={settings} reports={reports} />
      </PageSection>
      <PageSection
        title="Modelos"
        description="Borradores, preparados y declaraciones presentadas."
      >
        <FiscalReportsList canWrite={canWrite} reports={reports} />
      </PageSection>
    </PageShell>
  );
}

/**
 * Fiscalidad de países sin modelos oficiales todavía: resumen de impuestos por periodo, calculado
 * desde las facturas emitidas y recibidas con las mismas reglas que el resto del sistema.
 */
async function GenericFiscalPage({ companyId, country, currencyCode, period }: { companyId: string; country: CountryFiscalProfile; currencyCode: string; period?: string }) {
  const settings = await getFiscalSettings(companyId);
  const periods = recentTaxSummaryPeriods(new Date(), settings.taxPeriodicity);
  const selected = parseTaxSummaryPeriod(period) ?? periods[0];
  const summary = await calculateTaxSummary(companyId, selected, country.countryCode);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title={`Impuestos · ${country.countryName}`}
        description={`${country.taxLabel} repercutido en tus facturas menos el deducible de tus gastos, por periodo. Úsalo para presentar la declaración de ${country.countryName}.`}
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/accounting/gestor">
              Paquete para el gestor
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/settings/fiscal">
              Configuración
            </Link>
          </>
        }
      />
      <InlineAlert title="Cumplimiento básico" tone="info">
        Tus tipos de {country.taxLabel} y el tratamiento de cada factura se configuran solos según el país. Los modelos oficiales
        {country.isEu ? ", la declaración recapitulativa de operaciones intracomunitarias" : ""} y la factura electrónica de {country.countryName} todavía no
        se generan desde la aplicación.
      </InlineAlert>
      <PageSection title={`Resumen de ${country.taxLabel}`} description={summary.period.label}>
        <GenericTaxSummary country={country} currencyCode={currencyCode} periods={periods} summary={summary} />
      </PageSection>
    </PageShell>
  );
}
