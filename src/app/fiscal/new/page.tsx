import { CreateFiscalReportForm } from "@/components/fiscal/create-fiscal-report-form";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { companyHasAiem, getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { spanishFiscalModelsFor } from "@/lib/fiscal-spain";
import { getFiscalSettings } from "@/server/fiscal/settings";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { canFromDb } from "@/lib/rbac-server";

export default async function NewFiscalReportPage({ searchParams }: { searchParams: Promise<{ code?: string; period?: string }> }) {
  const ctx = await requireContext("fiscal.write");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const [canWrite, settings, query, territory] = await Promise.all([
    canFromDb(ctx.membership.role, "fiscal.write"),
    getFiscalSettings(ctx.company.id),
    searchParams,
    getCompanyTaxTerritory(ctx.company.id),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="Nuevo modelo"
        description={`Crea un borrador fiscal para ${ctx.company.name}.`}
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
      />

      <PageSection title="Datos del modelo" description="Elige el modelo y el periodo. Se crea como borrador y se abre su ficha para revisarlo.">
        {canWrite ? (
          <CreateFiscalReportForm
            initialCode={query.code}
            initialPeriod={query.period}
            models={spanishFiscalModelsFor(settings.taxpayerType, { vatReturns: getCountryFiscalProfile(territory).features.vatReturns, territory, aiem: territory === "ES-CN" && (await companyHasAiem(ctx.company.id)) })}
            periodicity={settings.taxPeriodicity}
          />
        ) : (
          <EmptyState title="Solo lectura" description="Necesitas permisos de escritura para crear modelos fiscales." />
        )}
      </PageSection>
    </PageShell>
  );
}
