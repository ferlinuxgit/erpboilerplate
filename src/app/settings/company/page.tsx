import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { CompanyProfileForm, type CompanyProfileFormValues } from "@/components/company/company-profile-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { company } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

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
    invoiceFooter: row.invoiceFooter ?? "",
  };
}

export default async function CompanySettingsPage() {
  const ctx = await requireContext("settings.manage");
  const [row] = await db
    .select()
    .from(company)
    .where(and(eq(company.id, ctx.company.id), eq(company.tenantId, ctx.tenant.id)))
    .limit(1);

  if (!row) notFound();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Empresa"
        description="Datos legales, fiscales y operativos usados por facturas, documentos, contexto activo y configuración ERP."
        backHref="/settings/masters"
        backLabel="Volver a maestros"
      />
      <PageSection title="Perfil de empresa" description="Mantén sincronizado el emisor de facturas, la localización fiscal y los datos públicos de contacto.">
        <CompanyProfileForm initialValues={toFormValues(row)} />
      </PageSection>
    </PageShell>
  );
}
