import { eq } from "drizzle-orm";

import { company, companySettings } from "@/db/schema";
import { getCountryFiscalProfile, type CountryFiscalProfile } from "@/lib/country-packs/profile";
import type { VatTreatmentContext } from "@/lib/country-packs/vat-treatment";
import { db, type DbClient } from "@/lib/db";

export type CompanyFiscalContext = Required<{ [K in keyof VatTreatmentContext]: string }> & {
  profile: CountryFiscalProfile;
};

/** País, qué vende y perfil fiscal de la empresa: lo que decide impuestos y tratamientos por defecto. */
export async function getCompanyFiscalContext(companyId: string, client: DbClient = db): Promise<CompanyFiscalContext> {
  const [row] = await client
    .select({ countryCode: company.countryCode, businessType: companySettings.businessType })
    .from(company)
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .where(eq(company.id, companyId))
    .limit(1);
  const profile = getCountryFiscalProfile(row?.countryCode);
  return { homeCountry: profile.countryCode, businessType: row?.businessType ?? "both", profile };
}
