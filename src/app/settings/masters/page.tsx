import { MastersPanel } from "@/components/settings/masters-panel";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";

export default async function MastersSettingsPage() {
  const ctx = await requireContext("settings.manage");

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
    </PageShell>
  );
}
