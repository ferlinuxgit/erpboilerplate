import { FiscalSettingsForm, VerifactuSettingsForm } from "@/components/fiscal/fiscal-settings-form";
import {
  EmptyState,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { canFromDb } from "@/lib/rbac-server";
import { getFiscalSettings } from "@/server/fiscal/settings";
import { isValidIssuerNifFormat } from "@/server/verifactu/format";
import { getVerifactuSettings } from "@/server/verifactu/settings";

export default async function FiscalSettingsPage() {
  const ctx = await requireContext("fiscal.read");
  const [settings, verifactu, canWrite] = await Promise.all([
    getFiscalSettings(ctx.company.id),
    getVerifactuSettings(db, ctx.company.id),
    canFromDb(ctx.membership.role, "fiscal.write"),
  ]);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad"
        title="Configuración fiscal"
        description="Cómo tributa tu negocio, qué modelos te tocan y el modo VERI*FACTU de tus facturas."
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
      />
      {canWrite ? (
        <>
          <PageSection title="Perfil fiscal" description="Estos valores deciden los modelos que aparecen en tu calendario y cómo se calculan.">
            <FiscalSettingsForm initialValues={settings} />
          </PageSection>
          <PageSection title="VERI*FACTU" description="Registro de facturas obligatorio por la Ley Antifraude (RD 1007/2023).">
            <VerifactuSettingsForm
              initialMode={verifactu.mode}
              initialSince={verifactu.since ? verifactu.since.toISOString().slice(0, 10) : ""}
              issuerTaxId={verifactu.issuerTaxId}
              issuerTaxIdValid={isValidIssuerNifFormat(verifactu.issuerTaxId)}
            />
          </PageSection>
        </>
      ) : (
        <PageSection title="Perfil fiscal">
          <EmptyState
            title="Solo lectura"
            description="Tu rol actual no permite modificar la configuración fiscal."
          />
        </PageSection>
      )}
    </PageShell>
  );
}
