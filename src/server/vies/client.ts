import { isEuCountry, normalizeCountryCode, viesCountryPrefix } from "@/lib/countries";

/**
 * Comprobación del NIF-IVA de un cliente de la UE en VIES (servicio público de la Comisión Europea).
 * https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{cc}/vat/{num}
 *
 * - Nunca lanza: si VIES no responde, tarda demasiado o el país está caído devuelve UNAVAILABLE
 *   para que el usuario pueda seguir trabajando y reintentar más tarde.
 * - `fetchImpl` se inyecta en tests (no se llama nunca al servicio real desde los tests).
 */

export const VIES_ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";
export const VIES_TIMEOUT_MS = 8_000;

export type ViesStatus = "VALID" | "INVALID" | "UNAVAILABLE";

export type ViesResult = {
  status: ViesStatus;
  countryCode: string;
  vatNumber: string;
  name: string | null;
  address: string | null;
  checkedAt: Date;
  /** Explicación para el usuario, en español llano. */
  message: string;
};

type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Separa "FR12345678901" / "12345678901" en prefijo de país y número (sin espacios ni signos). */
export function splitVatNumber(countryCode: string, taxId: string) {
  const prefix = viesCountryPrefix(countryCode);
  const compact = taxId.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const number = compact.startsWith(prefix) ? compact.slice(prefix.length) : compact;
  return { prefix, number };
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== "---" ? trimmed : null;
}

export async function checkVatNumber(
  countryCode: string,
  taxId: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; now?: () => Date } = {},
): Promise<ViesResult> {
  const now = options.now ?? (() => new Date());
  const country = normalizeCountryCode(countryCode);
  const { prefix, number } = splitVatNumber(country, taxId);
  const base = { countryCode: country, vatNumber: `${prefix}${number}`, name: null, address: null };

  if (!isEuCountry(country) || country === "ES") {
    return { ...base, status: "UNAVAILABLE", checkedAt: now(), message: "VIES solo comprueba NIF-IVA de clientes de otros países de la UE." };
  }
  if (!/^[A-Z0-9]{2,14}$/.test(number)) {
    return { ...base, status: "INVALID", checkedAt: now(), message: "El NIF-IVA no tiene un formato válido para VIES." };
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? VIES_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${VIES_ENDPOINT}/${encodeURIComponent(prefix)}/vat/${encodeURIComponent(number)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { ...base, status: "UNAVAILABLE", checkedAt: now(), message: "VIES no está disponible ahora mismo. Inténtalo más tarde." };
    }
    const payload = (await response.json()) as { isValid?: unknown; valid?: unknown; name?: unknown; address?: unknown; userError?: unknown };
    const valid = payload.isValid ?? payload.valid;
    if (typeof valid !== "boolean") {
      const userError = typeof payload.userError === "string" ? payload.userError : "";
      return {
        ...base,
        status: "UNAVAILABLE",
        checkedAt: now(),
        message: userError && userError !== "VALID" && userError !== "INVALID"
          ? "El servicio VIES de ese país no responde ahora mismo. Inténtalo más tarde."
          : "VIES no ha dado una respuesta clara. Inténtalo más tarde.",
      };
    }
    const name = cleanText(payload.name);
    return {
      ...base,
      status: valid ? "VALID" : "INVALID",
      name,
      address: cleanText(payload.address),
      checkedAt: now(),
      message: valid
        ? `NIF-IVA válido en VIES${name ? ` (${name})` : ""}. Puedes facturar sin IVA como operación intracomunitaria.`
        : "VIES indica que este NIF-IVA no está dado de alta para operaciones intracomunitarias: la factura debería llevar IVA español.",
    };
  } catch {
    return { ...base, status: "UNAVAILABLE", checkedAt: now(), message: "No se ha podido contactar con VIES (tiempo agotado). Inténtalo más tarde." };
  } finally {
    clearTimeout(timer);
  }
}
