import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { HttpError } from "@/lib/http";

/**
 * Las cuentas anuales en los modelos del PGC y los libros para el Registro Mercantil son normativa
 * española: solo se ofrecen a las empresas cuyo país tiene los modelos fiscales españoles.
 */
export function hasSpanishAnnualAccounts(countryCode: string | null | undefined) {
  return getCountryFiscalProfile(countryCode).features.taxReports === "es-aeat";
}

export function assertSpanishAnnualAccounts(countryCode: string | null | undefined) {
  if (!hasSpanishAnnualAccounts(countryCode)) throw new HttpError(404, "Esta función solo está disponible para empresas españolas.");
}
