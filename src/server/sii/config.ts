/**
 * Configuración del SII (entorno de la AEAT y transporte). Mismo criterio que VERI*FACTU
 * (`@/server/verifactu/config`).
 *
 * Variables de entorno:
 * - SII_TRANSPORT: "disabled" (por defecto) o "aeat" (envío real con certificado).
 * - SII_ENVIRONMENT: "production" o "test" (entorno de pruebas de la AEAT). OBLIGATORIA y sin valor
 *   por defecto con SII_TRANSPORT=aeat; sin envío activado se asume "test". Cada registro guarda el
 *   entorno en el que nació: cambiarla NO mueve los registros existentes.
 * - SII_CERT_PATH / SII_CERT_PASSWORD / SII_CERT_SEAL: certificado del sistema (.p12/.pfx), opcional.
 *   Cada empresa remite con el suyo (el mismo que sube para VERI*FACTU); el del sistema solo vale si
 *   su titular es colaborador social o apoderado de cada obligado.
 * - SII_ENDPOINT_BASE_URL: sustituye el origen de los servicios web (útil para un simulador).
 * - SII_EXTRA_HOLIDAYS: festivos nacionales añadidos al cómputo del plazo (AAAA-MM-DD, separados por comas).
 * - SII_WORKER_INTERVAL_MS: cada cuánto revisa y envía el worker (300000 por defecto).
 *
 * Puntos de acceso: los de los WSDL oficiales de la versión 1.1 «bis»
 * (https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii_1_1_bis/fact/ws/).
 */
import { HttpError } from "@/lib/http";
import type { SiiBook } from "@/server/sii/types";

export type SiiEnvironment = "test" | "production";
type Env = Record<string, string | undefined>;

export const siiEnvironmentLabels: Record<SiiEnvironment, string> = { production: "producción", test: "pruebas" };

export function isSiiEnvironment(value: unknown): value is SiiEnvironment {
  return value === "production" || value === "test";
}

export type SiiEnvironmentConfig = { environment: SiiEnvironment; problem: null } | { environment: null; problem: string };

/**
 * Entorno de la AEAT de este despliegue. Con el envío activado hay que declararlo: si faltara, las
 * facturas reales acabarían en pruebas (aceptadas, pero sin que Hacienda reciba nada).
 */
export function readSiiEnvironment(env: Env = process.env): SiiEnvironmentConfig {
  const raw = env.SII_ENVIRONMENT?.trim().toLowerCase() ?? "";
  if (isSiiEnvironment(raw)) return { environment: raw, problem: null };
  if (raw) return { environment: null, problem: `SII_ENVIRONMENT tiene un valor no válido («${raw}»): debe ser «production» o «test».` };
  if (env.SII_TRANSPORT === "aeat") {
    return { environment: null, problem: "Falta SII_ENVIRONMENT: hay que indicar de forma expresa «production» o «test» (no hay valor por defecto)." };
  }
  return { environment: "test", problem: null };
}

export function requireSiiEnvironment(env: Env = process.env): SiiEnvironment {
  const config = readSiiEnvironment(env);
  if (config.environment) return config.environment;
  throw new HttpError(503, `El SII no está bien configurado en este servidor. ${config.problem} Avisa al administrador del sistema.`);
}

const SERVICE_PATHS: Record<SiiBook, string> = {
  ISSUED: "/wlpl/SSII-FACT/ws/fe/SiiFactFEV1SOAP",
  RECEIVED: "/wlpl/SSII-FACT/ws/fr/SiiFactFRV1SOAP",
  // WSDL SuministroCobrosEmitidas, SuministroPagosRecibidas y SuministroBienesInversion (1.1 «bis»).
  ISSUED_COLLECTIONS: "/wlpl/SSII-FACT/ws/fe/SiiFactCOBV1SOAP",
  RECEIVED_PAYMENTS: "/wlpl/SSII-FACT/ws/fr/SiiFactPAGV1SOAP",
  INVESTMENT_GOODS: "/wlpl/SSII-FACT/ws/bi/SiiFactBIV1SOAP",
};

/** Orígenes de los servicios: uno para certificados de persona o representante y otro para los de sello. */
export const AEAT_SII_ORIGINS: Record<SiiEnvironment, { standard: string; seal: string }> = {
  production: { standard: "https://www1.agenciatributaria.gob.es", seal: "https://www10.agenciatributaria.gob.es" },
  test: { standard: "https://prewww1.aeat.es", seal: "https://prewww10.aeat.es" },
};

/** Punto de acceso de un envío: lo deciden el libro, el entorno DEL REGISTRO y el tipo de certificado. */
export function getSiiEndpoint(target: { book: SiiBook; environment: SiiEnvironment; seal?: boolean }, env: Env = process.env) {
  const override = env.SII_ENDPOINT_BASE_URL?.trim().replace(/\/+$/, "");
  const origins = AEAT_SII_ORIGINS[target.environment];
  return `${override || (target.seal ? origins.seal : origins.standard)}${SERVICE_PATHS[target.book]}`;
}

export type SiiTransportConfig =
  | { kind: "disabled"; reason: string }
  | { kind: "aeat"; environment: SiiEnvironment; certPath: string | null; certPassword: string; certSeal: boolean };

export function getSiiTransportConfig(env: Env = process.env): SiiTransportConfig {
  if (env.SII_TRANSPORT !== "aeat") return { kind: "disabled", reason: "El envío del SII a la AEAT no está activado (SII_TRANSPORT)." };
  const environment = readSiiEnvironment(env);
  if (!environment.environment) return { kind: "disabled", reason: environment.problem };
  return {
    kind: "aeat",
    environment: environment.environment,
    certPath: env.SII_CERT_PATH?.trim() || null,
    certPassword: env.SII_CERT_PASSWORD ?? "",
    certSeal: ["s", "si", "sí", "true", "1"].includes(env.SII_CERT_SEAL?.trim().toLowerCase() ?? ""),
  };
}
