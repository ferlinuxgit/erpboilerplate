/**
 * Configuración VeriFactu (entorno AEAT, sistema informático y transporte).
 *
 * Variables de entorno (todas opcionales; sin ellas los registros se generan y quedan pendientes de envío):
 * - VERIFACTU_ENVIRONMENT: "test" (preproducción AEAT, por defecto) o "production".
 * - VERIFACTU_TRANSPORT: "disabled" (por defecto) o "aeat" (envío real con certificado).
 * - VERIFACTU_CERT_PATH / VERIFACTU_CERT_PASSWORD: certificado del sistema (.p12/.pfx) para mTLS.
 *   Es opcional: cada empresa puede subir el suyo. El del sistema solo vale para remitir en nombre
 *   de terceros si su titular es colaborador social o apoderado de cada obligado ante la AEAT.
 * - VERIFACTU_ENDPOINT_URL: sobrescribe la URL del servicio web (útil para un simulador).
 * - VERIFACTU_QR_BASE_URL: sobrescribe la URL base del cotejo del QR.
 * - VERIFACTU_SYSTEM_NAME, VERIFACTU_SYSTEM_ID (2 caracteres), VERIFACTU_SYSTEM_VERSION,
 *   VERIFACTU_PRODUCER_NAME, VERIFACTU_PRODUCER_NIF, VERIFACTU_INSTALLATION_NUMBER: datos del
 *   bloque SistemaInformatico (productor del software y su declaración responsable).
 * - VERIFACTU_PRODUCER_ADDRESS, VERIFACTU_DECLARATION_DATE (AAAA-MM-DD), VERIFACTU_DECLARATION_PLACE:
 *   resto de datos de la declaración responsable (art. 15 Orden HAC/1177/2024).
 * - VERIFACTU_MULTI_OT: "S" (por defecto: la instalación da servicio a varios obligados) o "N".
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
  /** `certPath` es el certificado del sistema; null si cada empresa remite con el suyo. */
  | { kind: "aeat"; endpoint: string; certPath: string | null; certPassword: string };

const NIF_FORMAT = /^[0-9A-Z][0-9]{7}[0-9A-Z]$/;

export function getVerifactuTransportConfig(env: Env = process.env): VerifactuTransportConfig {
  if (env.VERIFACTU_TRANSPORT !== "aeat") {
    return { kind: "disabled", reason: "El envío a la AEAT no está activado (VERIFACTU_TRANSPORT)." };
  }
  // Sin NIF del productor el bloque SistemaInformatico no es válido y la AEAT rechaza el envío entero.
  if (!NIF_FORMAT.test((env.VERIFACTU_PRODUCER_NIF ?? "").trim().toUpperCase())) {
    return { kind: "disabled", reason: "Falta el NIF del productor del sistema informático (VERIFACTU_PRODUCER_NIF)." };
  }
  return { kind: "aeat", endpoint: getVerifactuEndpoint(env), certPath: env.VERIFACTU_CERT_PATH?.trim() || null, certPassword: env.VERIFACTU_CERT_PASSWORD ?? "" };
}

/** Datos de la declaración responsable del productor (art. 15 Orden HAC/1177/2024). */
export function getVerifactuDeclaration(env: Env = process.env) {
  const system = getVerifactuSystemInfo("", env);
  const producerNif = system.NIF;
  const missing: string[] = [];
  if (!env.VERIFACTU_PRODUCER_NAME?.trim()) missing.push("nombre o razón social del productor (VERIFACTU_PRODUCER_NAME)");
  if (!NIF_FORMAT.test(producerNif)) missing.push("NIF del productor (VERIFACTU_PRODUCER_NIF)");
  if (!env.VERIFACTU_PRODUCER_ADDRESS?.trim()) missing.push("dirección postal del productor (VERIFACTU_PRODUCER_ADDRESS)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.VERIFACTU_DECLARATION_DATE?.trim() ?? "")) missing.push("fecha de la declaración (VERIFACTU_DECLARATION_DATE)");
  if (!env.VERIFACTU_DECLARATION_PLACE?.trim()) missing.push("lugar de la declaración (VERIFACTU_DECLARATION_PLACE)");
  return {
    systemName: system.NombreSistemaInformatico,
    systemId: system.IdSistemaInformatico,
    version: system.Version,
    producerName: system.NombreRazon,
    producerNif,
    producerAddress: env.VERIFACTU_PRODUCER_ADDRESS?.trim() || null,
    date: env.VERIFACTU_DECLARATION_DATE?.trim() || null,
    place: env.VERIFACTU_DECLARATION_PLACE?.trim() || null,
    onlyVerifactu: system.TipoUsoPosibleSoloVerifactu === "S",
    multiTaxpayer: system.TipoUsoPosibleMultiOT === "S",
    missing,
    complete: missing.length === 0,
  };
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
    // Solo se puede usar como VERI*FACTU: no se ofrece la modalidad de registros firmados sin remisión.
    TipoUsoPosibleSoloVerifactu: "S",
    TipoUsoPosibleMultiOT: "S",
    IndicadorMultiplesOT: env.VERIFACTU_MULTI_OT?.trim().toUpperCase() === "N" ? "N" : "S",
  };
}
