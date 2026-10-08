import type { CompanyProfileFormValues } from "@/components/company/company-profile-form";
import type { company } from "@/db/schema";

/** Valores iniciales del perfil de empresa (lo comparten Configuración › Empresa y › Documentos). */
export function companyProfileFormValues(row: typeof company.$inferSelect): CompanyProfileFormValues {
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
