import { redirect } from "next/navigation";

import { getCountryFiscalProfile, type CountryFeatures } from "@/lib/country-packs/profile";
import { HttpError } from "@/lib/http";

type GuardedFeature = Extract<keyof CountryFeatures, "taxReports" | "eInvoicing">;

/**
 * Las pantallas de un país (modelos de la AEAT, VERI*FACTU…) solo existen para las empresas de
 * ese país: el resto vuelve a Fiscalidad, donde ve el resumen de impuestos de su país.
 */
export function requireCountryFeaturePage(countryCode: string | null | undefined, feature: GuardedFeature) {
  if (!getCountryFiscalProfile(countryCode).features[feature]) redirect("/fiscal");
}

/** Igual que `requireCountryFeaturePage` para la API. */
export function assertCountryFeature(countryCode: string | null | undefined, feature: GuardedFeature) {
  const profile = getCountryFiscalProfile(countryCode);
  if (!profile.features[feature]) {
    throw new HttpError(422, `Esta función fiscal no está disponible para empresas de ${profile.countryName}.`);
  }
}
