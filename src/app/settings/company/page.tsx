import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BusinessTypeForm } from "@/components/company/business-type-form";
import { CompanyProfileForm, type CompanyProfileFormValues } from "@/components/company/company-profile-form";
import { PdfSettingsForm } from "@/components/company/pdf-settings-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { company, companySettings } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { parseBusinessType } from "@/lib/company-readiness";
import { db } from "@/lib/db";
import { defaultPdfDisplaySettings } from "@/lib/pdf-settings";

function toFormValues(row: typeof company.$inferSelect): CompanyProfileFormValues {
  return {
    name: row.name,
    legalName: row.legalName ?? "",
    vatNumber: row.vatNumber ?? "",
    fiscalAddress: row.fiscalAddress ?? "",
    fiscalAddressLine2: row.fiscalAddressLine2 ?? "",
    postalCode: row.postalCode ?? "",
    city: row.city ?? "",
    province: row.province ?? "",
    countryCode: row.countryCode,
    timezone: row.timezone,
    baseCurrencyCode: row.baseCurrencyCode,
    email: row.email ?? "",
    phone: row.phone ?? "",
    website: row.website ?? "",
    logoDataUrl: row.logoDataUrl ?? "",
    invoiceFooter: row.invoiceFooter ?? "",
  };
}

export const metadata: Metadata = { title: "Empresa" };

function pdfDisplaySettingsFrom(row: { showLogo: boolean; showEmail: boolean; showPhone: boolean; showWebsite: boolean; showCustomerNumber: boolean; showPaymentMethod: boolean; showTaxBreakdown: boolean }) {
  return {
    showLogo: row.showLogo,
    showEmail: row.showEmail,
    showPhone: row.showPhone,
    showWebsite: row.showWebsite,
    showCustomerNumber: row.showCustomerNumber,
    showPaymentMethod: row.showPaymentMethod,
    showTaxBreakdown: row.showTaxBreakdown,
  };
}

export default async function CompanySettingsPage() {
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
      businessType: companySettings.businessType,
    }).from(companySettings).where(eq(companySettings.companyId, ctx.company.id)).limit(1),
  ]);

  if (!row) notFound();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Empresa"
        description="Datos legales y fiscales que aparecen en tus facturas y documentos."
        backHref="/dashboard"
        backLabel="Volver al panel"
      />
      <PageSection title="Perfil de empresa" description="Mantén sincronizado el emisor de facturas, la localización fiscal y los datos públicos de contacto.">
        <CompanyProfileForm initialValues={toFormValues(row)} />
      </PageSection>
      <PageSection title="Actividad" description="Qué vendes: ocultamos inventario, albaranes y recepciones si solo prestas servicios.">
        <BusinessTypeForm initialValue={parseBusinessType(pdfSettings?.businessType)} />
      </PageSection>
      <PageSection title="Diseño y contenido de PDFs" description="Decide qué información pública aparece al generar facturas y documentos comerciales, incluidos los ya creados.">
        <PdfSettingsForm initialValues={pdfSettings ? pdfDisplaySettingsFrom(pdfSettings) : defaultPdfDisplaySettings} />
      </PageSection>
    </PageShell>
  );
}
