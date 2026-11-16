import { and, eq, sql } from "drizzle-orm";

import { company, companySettings, tax } from "@/db/schema";
import { igicExemptRegime } from "@/lib/country-packs/igic";
import { getCountryFiscalProfile, type CountryFiscalProfile } from "@/lib/country-packs/profile";
import { taxTerritoryOf } from "@/lib/country-packs/territory";
import type { VatTreatmentContext } from "@/lib/country-packs/vat-treatment";
import { db, type DbClient } from "@/lib/db";

export type CompanyFiscalContext = {
  /** Territorio fiscal (ES, ES-CN…): `homeCountry` de las reglas de tratamiento. */
  homeCountry: string;
  businessType: string;
  /** Régimen fiscal de la empresa (ajustes): general, comerciante_minorista, pequeno_empresario… */
  fiscalRegime: string;
  /** Ventas interiores exentas por régimen (IGIC minorista / REPEP). */
  salesExempt: boolean;
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
    .select({ countryCode: company.countryCode, postalCode: company.postalCode, province: company.province, businessType: companySettings.businessType, fiscalRegime: companySettings.fiscalRegime })
    .from(company)
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .where(eq(company.id, companyId))
    .limit(1);
  const profile = getCountryFiscalProfile(taxTerritoryOf(row) ?? "ES");
  const fiscalRegime = row?.fiscalRegime ?? "general";
  return {
    homeCountry: profile.territory,
    businessType: row?.businessType ?? "both",
    fiscalRegime,
    salesExempt: igicExemptRegime(profile.territory, fiscalRegime),
    profile,
  };
}

/** Contexto de tratamiento del IVA/IGIC/IPSI para los formularios (territorio, qué vende y régimen). */
export async function vatContextFor(companyId: string): Promise<VatTreatmentContext> {
  const fiscal = await getCompanyFiscalContext(companyId);
  return { homeCountry: fiscal.homeCountry, businessType: fiscal.businessType, salesExempt: fiscal.salesExempt };
}

/** ¿La empresa factura el AIEM? (tiene impuestos «AIEM» activos, creados desde la configuración fiscal). */
export async function companyHasAiem(companyId: string, client: DbClient = db): Promise<boolean> {
  const [row] = await client
    .select({ id: tax.id })
    .from(tax)
    .where(and(eq(tax.companyId, companyId), eq(tax.isActive, true), eq(tax.kind, "OTHER"), sql`upper(${tax.name}) LIKE 'AIEM%'`))
    .limit(1);
  return Boolean(row);
}
