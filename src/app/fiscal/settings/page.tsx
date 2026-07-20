import { FiscalSettingsForm } from "@/components/fiscal/fiscal-settings-form";
import {
  EmptyState,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { canFromDb } from "@/lib/rbac-server";
import { getFiscalSettings } from "@/server/fiscal/settings";

export default async function FiscalSettingsPage() {
  const ctx = await requireContext("fiscal.read");
  const [settings, canWrite] = await Promise.all([
    getFiscalSettings(ctx.company.id),
    canFromDb(ctx.membership.role, "fiscal.write"),
  ]);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="Configuración fiscal"
        description="Régimen, periodicidad, prorrata, SII, Verifactu y cuentas contables por defecto."
        backHref="/fiscal"
        backLabel="Volver a modelos"
      />
      <PageSection
        title="Perfil fiscal"
        description="Estos valores gobiernan el cálculo y las validaciones de los modelos."
      >
        {canWrite ? (
          <FiscalSettingsForm initialValues={settings} />
        ) : (
          <EmptyState
            title="Solo lectura"
            description="Tu rol actual no permite modificar la configuración fiscal."
          />
        )}
      </PageSection>
    </PageShell>
  );
}
