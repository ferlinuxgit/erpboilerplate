/**
 * Configuración VeriFactu (entorno AEAT, sistema informático y transporte).
 *
 * Variables de entorno (todas opcionales; sin ellas los registros se generan y quedan pendientes de envío):
 * - VERIFACTU_ENVIRONMENT: "test" (preproducción AEAT, por defecto) o "production".
 * - VERIFACTU_TRANSPORT: "disabled" (por defecto) o "aeat" (envío real con certificado).
 * - VERIFACTU_CERT_PATH / VERIFACTU_CERT_PASSWORD: certificado cualificado (.p12/.pfx) para mTLS.
 * - VERIFACTU_ENDPOINT_URL: sobrescribe la URL del servicio web (útil para un simulador).
 * - VERIFACTU_QR_BASE_URL: sobrescribe la URL base del cotejo del QR.
 * - VERIFACTU_SYSTEM_NAME, VERIFACTU_SYSTEM_ID (2 caracteres), VERIFACTU_SYSTEM_VERSION,
 *   VERIFACTU_PRODUCER_NAME, VERIFACTU_PRODUCER_NIF, VERIFACTU_INSTALLATION_NUMBER: datos del
 *   bloque SistemaInformatico (productor del software y su declaración responsable).
 */

export type VerifactuEnvironment = "test" | "production";

export type VerifactuSystemInfo = {
  NombreRazon: string;
  NIF: string;
  NombreSistemaInformatico: string;
  IdSistemaInformatico: string;
  Version: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu: "S" | "N";
  TipoUsoPosibleMultiOT: "S" | "N";
  IndicadorMultiplesOT: "S" | "N";
};

type Env = Record<string, string | undefined>;

export function getVerifactuEnvironment(env: Env = process.env): VerifactuEnvironment {
  return env.VERIFACTU_ENVIRONMENT === "production" ? "production" : "test";
}

/** Servicio web de remisión (SOAP, RegFactuSistemaFacturacion) con certificado cualificado. */
export const AEAT_VERIFACTU_ENDPOINTS: Record<VerifactuEnvironment, string> = {
  production: "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  test: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};

/** Servicio de cotejo de facturas por QR (art. 21 Orden HAC/1177/2024 y documento "Características del QR"). */
export const AEAT_QR_BASE_URLS: Record<VerifactuEnvironment, { verifactu: string; noVerifactu: string }> = {
  production: {
    verifactu: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
    noVerifactu: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu",
  },
  test: {
    verifactu: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
    noVerifactu: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu",
  },
};

export function getVerifactuEndpoint(env: Env = process.env) {
  return env.VERIFACTU_ENDPOINT_URL?.trim() || AEAT_VERIFACTU_ENDPOINTS[getVerifactuEnvironment(env)];
}

export function getQrBaseUrl(mode: "VERIFACTU" | "NO_VERIFACTU", env: Env = process.env) {
  const override = env.VERIFACTU_QR_BASE_URL?.trim();
  if (override) return override;
  const urls = AEAT_QR_BASE_URLS[getVerifactuEnvironment(env)];
  return mode === "VERIFACTU" ? urls.verifactu : urls.noVerifactu;
}

export type VerifactuTransportConfig =
  | { kind: "disabled"; reason: string }
  | { kind: "aeat"; endpoint: string; certPath: string; certPassword: string };

export function getVerifactuTransportConfig(env: Env = process.env): VerifactuTransportConfig {
  if (env.VERIFACTU_TRANSPORT !== "aeat") {
    return { kind: "disabled", reason: "El envío a la AEAT no está activado (VERIFACTU_TRANSPORT)." };
  }
  const certPath = env.VERIFACTU_CERT_PATH?.trim();
  if (!certPath) return { kind: "disabled", reason: "Falta el certificado electrónico (VERIFACTU_CERT_PATH)." };
  return { kind: "aeat", endpoint: getVerifactuEndpoint(env), certPath, certPassword: env.VERIFACTU_CERT_PASSWORD ?? "" };
}

function clean(value: string | undefined, fallback: string, maxLength: number) {
  const trimmed = value?.trim();
  return (trimmed || fallback).slice(0, maxLength);
}

/** Bloque SistemaInformatico. `installationKey` identifica la instalación (por defecto, la empresa). */
export function getVerifactuSystemInfo(installationKey: string, env: Env = process.env): VerifactuSystemInfo {
  return {
    NombreRazon: clean(env.VERIFACTU_PRODUCER_NAME, "ERP Suite", 120),
    NIF: clean(env.VERIFACTU_PRODUCER_NIF, "", 9).toUpperCase(),
    NombreSistemaInformatico: clean(env.VERIFACTU_SYSTEM_NAME, "ERP Suite", 30),
    IdSistemaInformatico: clean(env.VERIFACTU_SYSTEM_ID, "ES", 2),
    Version: clean(env.VERIFACTU_SYSTEM_VERSION, "0.1.0", 50),
    NumeroInstalacion: clean(env.VERIFACTU_INSTALLATION_NUMBER, installationKey, 100),
    TipoUsoPosibleSoloVerifactu: "N",
    TipoUsoPosibleMultiOT: "S",
    IndicadorMultiplesOT: "N",
  };
}
