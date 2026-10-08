import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BusinessTypeForm } from "@/components/company/business-type-form";
import { CompanyProfileForm } from "@/components/company/company-profile-form";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { company, companySettings } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { parseBusinessType } from "@/lib/company-readiness";
import { db } from "@/lib/db";
import { companyProfileFormValues } from "@/server/company/profile-form-values";

export const metadata: Metadata = { title: "Empresa" };

export default async function CompanySettingsPage() {
  const ctx = await requireContext("settings.manage");
  const [[row], [settings]] = await Promise.all([
    db.select().from(company).where(and(eq(company.id, ctx.company.id), eq(company.tenantId, ctx.tenant.id))).limit(1),
    db.select({ businessType: companySettings.businessType }).from(companySettings).where(eq(companySettings.companyId, ctx.company.id)).limit(1),
  ]);
  if (!row) notFound();

  return (
    <PageShell>
      <SettingsPageHeader sectionId="company" />
      <PageSection className="scroll-mt-24" id="perfil" title="Datos fiscales y contacto" description="El emisor que aparece en tus facturas: razón social, NIF, domicilio y contacto.">
        <CompanyProfileForm initialValues={companyProfileFormValues(row)} part="identity" />
      </PageSection>
      <PageSection className="scroll-mt-24" id="actividad" title="Actividad" description="Qué vendes: ocultamos inventario, albaranes y recepciones si solo prestas servicios.">
        <BusinessTypeForm initialValue={parseBusinessType(settings?.businessType)} />
      </PageSection>
    </PageShell>
  );
}
