import type { Metadata } from "next";

import { FiscalSettingsForm, VerifactuSettingsForm } from "@/components/fiscal/fiscal-settings-form";
import { MastersPanel } from "@/components/settings/masters-panel";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { EmptyState, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getFiscalSettings } from "@/server/fiscal/settings";
import { isValidIssuerNifFormat } from "@/server/verifactu/format";
import { getVerifactuSettings } from "@/server/verifactu/settings";

export const metadata: Metadata = { title: "Fiscalidad" };

export default async function FiscalSettingsPage() {
  const ctx = await requireContext("fiscal.read");
  const canWrite = can(ctx.membership.role, "fiscal.write");
  const canManageTaxes = can(ctx.membership.role, "settings.manage");
  const [settings, verifactu] = await Promise.all([
    getFiscalSettings(ctx.company.id),
    getVerifactuSettings(db, ctx.company.id),
  ]);

  return (
    <PageShell>
      <SettingsPageHeader sectionId="fiscal" />
      {canWrite ? (
        <>
          <PageSection className="scroll-mt-24" id="perfil" title="Perfil fiscal" description="Estos valores deciden los modelos que aparecen en tu calendario y cómo se calculan.">
            <FiscalSettingsForm initialValues={settings} />
          </PageSection>
          <PageSection className="scroll-mt-24" id="verifactu" title="VERI*FACTU" description="Registro de facturas obligatorio por la Ley Antifraude (RD 1007/2023).">
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
          <EmptyState title="Solo lectura" description="Tu rol actual no permite modificar la configuración fiscal." />
        </PageSection>
      )}
      {canManageTaxes ? (
        <PageSection className="scroll-mt-24" id="impuestos" title="Impuestos y retenciones" description="Tipos que se proponen al añadir líneas a facturas y gastos.">
          <MastersPanel blocks={["taxes"]} />
        </PageSection>
      ) : null}
    </PageShell>
  );
}
