import type { Metadata } from "next";

import { AiemSettingsForm, FiscalSettingsForm, VerifactuSettingsForm } from "@/components/fiscal/fiscal-settings-form";
import { TaxCatalogPanel } from "@/components/settings/tax-catalog-panel";
import { VatTreatmentsPanel } from "@/components/settings/vat-treatments-panel";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { EmptyState, InlineAlert, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { db } from "@/lib/db";
import { companyHasAiem, getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { can } from "@/lib/rbac";
import { getFiscalSettings } from "@/server/fiscal/settings";
import { getCompanySalesVatTreatments } from "@/server/invoices/vat-treatments";
import { isValidIssuerNifFormat } from "@/server/verifactu/format";
import { getVerifactuSettings } from "@/server/verifactu/settings";
import { getVerifactuOverview } from "@/server/verifactu/service";

export const metadata: Metadata = { title: "Fiscalidad" };

export default async function FiscalSettingsPage() {
  const ctx = await requireContext("fiscal.read");
  const canWrite = can(ctx.membership.role, "fiscal.write");
  const canManageTaxes = can(ctx.membership.role, "settings.manage");
  const country = getCountryFiscalProfile(await getCompanyTaxTerritory(ctx.company.id));
  const [settings, verifactu, verifactuOverview, vatTreatments] = await Promise.all([
    getFiscalSettings(ctx.company.id),
    getVerifactuSettings(db, ctx.company.id),
    getVerifactuOverview(ctx.company.id),
    getCompanySalesVatTreatments(ctx.company.id),
  ]);

  return (
    <PageShell>
      <SettingsPageHeader sectionId="fiscal" />
      {canWrite ? (
        <>
          {country.level === "full" && !country.features.vatReturns ? (
            <InlineAlert className="mb-3" title={`${country.territoryName}: ${country.taxLabel} en lugar de IVA`} tone="info">
              Tu domicilio fiscal está en {country.territoryName}: tus facturas llevan {country.taxLabel} (tipos ya creados), sin recargo de
              equivalencia, y no presentas los modelos de IVA (303, 390, 349). Siguen aplicando VERI*FACTU y los modelos 111, 115, 130 y 347
              {country.territory === "ES-CN" ? ", y en Fiscalidad preparas el 420 y el 425 del IGIC" : ""}.
              Las ventas a la península y al extranjero se proponen como exportación o no sujetas.
            </InlineAlert>
          ) : null}
          {country.level !== "full" ? (
            <InlineAlert className="mb-3" title={`Fiscalidad de ${country.countryName}: configuración automática`} tone="info">
              Los tipos de {country.taxLabel} de {country.countryName} y un plan contable general se han configurado solos, y cada factura
              propone el tratamiento según el país y el {country.taxIdLabel} del cliente. Los modelos oficiales y la factura electrónica
              de este país aún no están disponibles: en Fiscalidad tienes el resumen de impuestos de cada periodo para declararlo.
            </InlineAlert>
          ) : null}
          <PageSection
            className="scroll-mt-24"
            id="perfil"
            title="Perfil fiscal"
            description={country.features.taxReports ? "Estos valores deciden los modelos que aparecen en tu calendario y cómo se calculan." : "Periodo con el que se agrupa tu resumen de impuestos."}
          >
            <FiscalSettingsForm
              initialValues={settings}
              spanishRegimes={country.features.taxReports === "es-aeat"}
              vatRegimes={country.features.vatReturns}
              igicRegimes={country.territory === "ES-CN"}
              taxLabel={country.taxLabel}
            />
          </PageSection>
          {country.territory === "ES-CN" ? (
            <PageSection className="scroll-mt-24" id="aiem" title="AIEM" description="Arbitrio sobre Importaciones y Entregas de Mercancías en Canarias (modelo 450).">
              <AiemSettingsForm initialEnabled={await companyHasAiem(ctx.company.id)} />
            </PageSection>
          ) : null}
          {country.features.eInvoicing === "verifactu" ? (
          <PageSection className="scroll-mt-24" id="verifactu" title="VERI*FACTU" description="Registro de facturas obligatorio por la Ley Antifraude (RD 1007/2023).">
            <VerifactuSettingsForm
              initialMode={verifactu.mode}
              initialSince={verifactu.since ? verifactu.since.toISOString().slice(0, 10) : ""}
              issuerTaxId={verifactu.issuerTaxId}
              issuerTaxIdValid={isValidIssuerNifFormat(verifactu.issuerTaxId)}
              operational={verifactuOverview.transport.enabled}
              notOperationalReason={verifactuOverview.transport.reason}
              hasRecords={verifactuOverview.totalRecords > 0}
              transportEnabled={verifactuOverview.transportActive}
              certificate={verifactuOverview.certificate.own ? { fileName: verifactuOverview.certificate.own.fileName, uploadedAt: verifactuOverview.certificate.own.uploadedAt.toISOString() } : null}
              systemCertificate={verifactuOverview.certificate.systemAvailable}
            />
          </PageSection>
          ) : null}
        </>
      ) : (
        <PageSection title="Perfil fiscal">
          <EmptyState title="Solo lectura" description="Tu rol actual no permite modificar la configuración fiscal." />
        </PageSection>
      )}
      {canManageTaxes ? (
        <PageSection className="scroll-mt-24" id="impuestos" title="Impuestos y retenciones" description="Elige del catálogo los que usas en tu negocio: solo esos aparecen al facturar.">
          <TaxCatalogPanel taxLabel={country.taxLabel} />
        </PageSection>
      ) : null}
      {canManageTaxes ? (
        <PageSection className="scroll-mt-24" id="tratamientos-iva" title="Tratamientos de IVA" description="Elige los que usas en tus ventas: solo esos aparecen al facturar.">
          <VatTreatmentsPanel initialAutomatic={vatTreatments.automatic} initialEnabled={vatTreatments.enabled} />
        </PageSection>
      ) : null}
    </PageShell>
  );
}
