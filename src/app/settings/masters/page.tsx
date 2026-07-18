import { CompanyDefaultsPanel } from "@/components/company/company-defaults-panel";
import { LazyAccountingMasters } from "@/components/settings/lazy-accounting-masters";
import { MastersPanel } from "@/components/settings/masters-panel";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { getCompanyTemplate } from "@/lib/company-templates";
import { requireContext } from "@/lib/current-context";
import { getAccountingMasterStatus } from "@/server/accounting/masters";
import { getCompanyDefaultsStatus } from "@/server/company/defaults";

export default async function MastersSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const template = getCompanyTemplate(ctx.company.countryCode);
  const [accountingMasterStatus, defaultsStatus] = await Promise.all([
    getAccountingMasterStatus(ctx.company.id, undefined, template),
    getCompanyDefaultsStatus({
      companyId: ctx.company.id,
      fiscalYearId: ctx.fiscalYear.id,
      countryCode: ctx.company.countryCode,
    }),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Maestros"
        description={`Configuración de catálogos base para ${ctx.company.name}.`}
        actions={<a className={buttonVariants({ variant: "outline" })} href="/settings/company">Editar empresa</a>}
      />
      <PageSection
        title="Configuración de empresa"
        description="Estado de los ajustes necesarios para operar sin introducir códigos contables a mano."
      >
        <CompanyDefaultsPanel initialStatus={defaultsStatus} />
      </PageSection>
      <PageSection title="Catálogos base" description="Mantén unidades, impuestos, series, diarios y datos maestros alineados con la operación.">
        <MastersPanel />
      </PageSection>
      <PageSection title="Avanzado" description="Catálogo contable predefinido para revisar o completar cuentas y diarios concretos.">
        <LazyAccountingMasters
          catalogAccounts={template?.accounts ?? []}
          catalogJournals={template?.journals ?? []}
          catalogLabel={template?.label ?? "Sin plantilla"}
          missingAccounts={accountingMasterStatus.missingAccounts}
          missingJournals={accountingMasterStatus.missingJournals}
        />
      </PageSection>
    </PageShell>
  );
}
