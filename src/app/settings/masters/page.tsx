import { AccountingMastersForm } from "@/components/accounting/accounting-masters-form";
import { MastersPanel } from "@/components/settings/masters-panel";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getAccountingMasterStatus } from "@/server/accounting/masters";

export default async function MastersSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const accountingMasterStatus = await getAccountingMasterStatus(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Maestros"
        description={`Configuración de catálogos base para ${ctx.company.name}.`}
      />
      <PageSection title="Catálogos base" description="Mantén unidades, impuestos, series, diarios y datos maestros alineados con la operación.">
        <MastersPanel />
      </PageSection>
      <PageSection title="Maestros contables" description="Catálogo de cuentas y diarios predefinidos para España.">
        <AccountingMastersForm
          missingAccounts={accountingMasterStatus.missingAccounts}
          missingJournals={accountingMasterStatus.missingJournals}
        />
      </PageSection>
    </PageShell>
  );
}
