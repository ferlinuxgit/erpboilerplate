import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompanyProfileForm } from "@/components/company/company-profile-form";
import { PdfSettingsForm } from "@/components/company/pdf-settings-form";
import { MastersPanel } from "@/components/settings/masters-panel";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { company, companySettings } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { defaultPdfDisplaySettings } from "@/lib/pdf-settings";
import { companyProfileFormValues } from "@/server/company/profile-form-values";

export const metadata: Metadata = { title: "Documentos" };

export default async function DocumentsSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const [[row], [pdfSettings]] = await Promise.all([
    db.select().from(company).where(and(eq(company.id, ctx.company.id), eq(company.tenantId, ctx.tenant.id))).limit(1),
    db.select({
      showLogo: companySettings.pdfShowLogo,
      showEmail: companySettings.pdfShowEmail,
      showPhone: companySettings.pdfShowPhone,
      showWebsite: companySettings.pdfShowWebsite,
      showCustomerNumber: companySettings.pdfShowCustomerNumber,
      showPaymentMethod: companySettings.pdfShowPaymentMethod,
      showTaxBreakdown: companySettings.pdfShowTaxBreakdown,
    }).from(companySettings).where(eq(companySettings.companyId, ctx.company.id)).limit(1),
  ]);
  if (!row) notFound();

  return (
    <PageShell>
      <SettingsPageHeader sectionId="documents" />
      <PageSection className="scroll-mt-24" id="logo" title="Logo y pie de factura" description="La imagen de tu empresa y el texto que se imprime al final de las facturas.">
        <CompanyProfileForm initialValues={companyProfileFormValues(row)} part="documents" />
      </PageSection>
      <PageSection className="scroll-mt-24" id="pdf" title="Contenido del PDF" description="Qué datos aparecen al generar facturas y documentos comerciales, incluidos los ya creados.">
        <PdfSettingsForm initialValues={pdfSettings ?? defaultPdfDisplaySettings} />
      </PageSection>
      <PageSection className="scroll-mt-24" id="series" title="Series de numeración" description="Prefijo, formato y siguiente número de cada tipo de documento en el ejercicio activo.">
        <MastersPanel blocks={["series"]} />
      </PageSection>
    </PageShell>
  );
}
