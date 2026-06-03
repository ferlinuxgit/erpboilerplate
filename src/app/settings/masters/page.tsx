import { AccountingMastersForm } from "@/components/accounting/accounting-masters-form";
import { CompanyDefaultsPanel } from "@/components/company/company-defaults-panel";
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
        title="Configuracion de empresa"
        description="Estado de los ajustes necesarios para operar sin introducir codigos contables a mano."
      >
        <CompanyDefaultsPanel initialStatus={defaultsStatus} />
      </PageSection>
      <PageSection title="Catálogos base" description="Mantén unidades, impuestos, series, diarios y datos maestros alineados con la operación.">
        <MastersPanel />
      </PageSection>
      <PageSection title="Avanzado" description="Catalogo contable predefinido para revisar o completar cuentas y diarios concretos.">
        <details>
          <summary className="cursor-pointer text-sm font-medium">Ver catalogo contable de la plantilla</summary>
          <div className="mt-4">
            <AccountingMastersForm
              catalogAccounts={template?.accounts ?? []}
              catalogJournals={template?.journals ?? []}
              catalogLabel={template?.label ?? "Sin plantilla"}
              missingAccounts={accountingMasterStatus.missingAccounts}
              missingJournals={accountingMasterStatus.missingJournals}
            />
          </div>
        </details>
      </PageSection>
    </PageShell>
  );
}
