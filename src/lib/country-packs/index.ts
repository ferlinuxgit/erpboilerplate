/**
 * Paquete fiscal completo del país: perfil (capacidades, moneda, impuestos) + plantilla contable.
 * Solo servidor (la plantilla incluye el plan contable completo). En cliente, usar `./profile`.
 */
import { getCompanyTemplate, type CompanyTemplate } from "@/lib/company-templates";
import { getCountryFiscalProfile, type CountryFiscalProfile } from "@/lib/country-packs/profile";

export * from "@/lib/country-packs/profile";

export type CountryPack = CountryFiscalProfile & { template: CompanyTemplate };

export function getCountryPack(countryCode: string | null | undefined): CountryPack {
  const profile = getCountryFiscalProfile(countryCode);
  return { ...profile, template: getCompanyTemplate(profile.countryCode) };
}
