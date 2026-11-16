import { eq } from "drizzle-orm";

import { company, companySettings } from "@/db/schema";
import { getCountryFiscalProfile, type CountryFiscalProfile } from "@/lib/country-packs/profile";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import type { VatTreatmentContext } from "@/lib/country-packs/vat-treatment";
import { db, type DbClient } from "@/lib/db";

export type CompanyFiscalContext = Required<{ [K in keyof VatTreatmentContext]: string }> & {
  profile: CountryFiscalProfile;
};

/**
 * Territorio fiscal de la empresa (país, o ES-CN / ES-CE / ES-ML según su domicilio fiscal): es lo
 * que decide impuestos, plantilla y tratamientos por defecto.
 */
export async function getCompanyTaxTerritory(companyId: string, client: DbClient = db): Promise<string> {
  const [row] = await client
    .select({ countryCode: company.countryCode, postalCode: company.postalCode, province: company.province })
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);
  return taxTerritoryOf(row) ?? "ES";
}

/** Territorio, qué vende y perfil fiscal de la empresa: lo que decide impuestos y tratamientos por defecto. */
export async function getCompanyFiscalContext(companyId: string, client: DbClient = db): Promise<CompanyFiscalContext> {
  const [row] = await client
    .select({ countryCode: company.countryCode, postalCode: company.postalCode, province: company.province, businessType: companySettings.businessType })
    .from(company)
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .where(eq(company.id, companyId))
    .limit(1);
  const profile = getCountryFiscalProfile(taxTerritoryOf(row) ?? "ES");
  return { homeCountry: profile.territory, businessType: row?.businessType ?? "both", profile };
}
