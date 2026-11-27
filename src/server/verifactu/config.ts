/**
 * Configuración VeriFactu (entorno AEAT, sistema informático y transporte).
 *
 * Variables de entorno:
 * - VERIFACTU_ENVIRONMENT: "production" o "test" (preproducción AEAT). OBLIGATORIA y sin valor por
 *   defecto con VERIFACTU_TRANSPORT=aeat; sin envío activado se asume "test".
 *   Cada registro guarda el entorno en el que nació: cambiarla NO mueve los registros existentes
 *   (los del otro entorno dejan de enviarse y se avisa en pantalla).
 * - VERIFACTU_TRANSPORT: "disabled" (por defecto) o "aeat" (envío real con certificado).
 * - VERIFACTU_CERT_PATH / VERIFACTU_CERT_PASSWORD: certificado del sistema (.p12/.pfx) para mTLS.
 *   Es opcional: cada empresa puede subir el suyo. El del sistema solo vale para remitir en nombre
 *   de terceros si su titular es colaborador social o apoderado de cada obligado ante la AEAT.
 * - VERIFACTU_CERT_SEAL: "S" si el certificado del sistema es de sello electrónico (usa el punto de
 *   acceso de sello de la AEAT: www10 / prewww10).
 * - VERIFACTU_ENDPOINT_URL: sobrescribe la URL del servicio web (útil para un simulador).
 * - VERIFACTU_QR_BASE_URL: sobrescribe la URL base del cotejo del QR.
 * - VERIFACTU_SYSTEM_NAME, VERIFACTU_SYSTEM_ID (2 caracteres), VERIFACTU_SYSTEM_VERSION,
 *   VERIFACTU_PRODUCER_NAME, VERIFACTU_PRODUCER_NIF, VERIFACTU_INSTALLATION_NUMBER: datos del
 *   bloque SistemaInformatico (productor del software y su declaración responsable).
 * - VERIFACTU_PRODUCER_ADDRESS, VERIFACTU_DECLARATION_DATE (AAAA-MM-DD), VERIFACTU_DECLARATION_PLACE:
 *   resto de datos de la declaración responsable (art. 15 Orden HAC/1177/2024).
 * - VERIFACTU_MULTI_OT: "S" (por defecto: la instalación da servicio a varios obligados) o "N".
 */

import { HttpError } from "@/lib/http";

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

export const VERIFACTU_ENVIRONMENTS = ["production", "test"] as const;

export const verifactuEnvironmentLabels: Record<VerifactuEnvironment, string> = { production: "producción", test: "pruebas" };

/** Rótulo que acompaña a todo lo que procede del entorno de pruebas de la AEAT (pantallas, PDF y tickets). */
export const TEST_ENVIRONMENT_LABEL = "ENTORNO DE PRUEBAS";
export const TEST_ENVIRONMENT_LEGEND = "ENTORNO DE PRUEBAS · SIN VALIDEZ FISCAL";

export function isVerifactuEnvironment(value: unknown): value is VerifactuEnvironment {
  return value === "production" || value === "test";
}

export type VerifactuEnvironmentConfig =
  | { environment: VerifactuEnvironment; problem: null }
  | { environment: null; problem: string };

/**
 * Entorno de la AEAT de este despliegue. Hay que declararlo: si faltara, las facturas reales
 * acabarían en el entorno de pruebas (aceptadas y con QR, pero sin que Hacienda reciba nada).
 * Solo en desarrollo, sin envío activado, se asume «pruebas».
 */
export function readVerifactuEnvironment(env: Env = process.env): VerifactuEnvironmentConfig {
  const raw = env.VERIFACTU_ENVIRONMENT?.trim().toLowerCase() ?? "";
  if (isVerifactuEnvironment(raw)) return { environment: raw, problem: null };
  if (raw) {
    return { environment: null, problem: `VERIFACTU_ENVIRONMENT tiene un valor no válido («${raw}»): debe ser «production» o «test».` };
  }
  // Sin envío a la AEAT nada sale del sistema: los registros nacen como «pruebas» (y así se rotulan)
  // en vez de impedir la emisión. En cuanto se activa el envío, el entorno debe declararse.
  if (env.VERIFACTU_TRANSPORT === "aeat") {
    return { environment: null, problem: "Falta VERIFACTU_ENVIRONMENT: hay que indicar de forma expresa «production» o «test» (no hay valor por defecto)." };
  }
  return { environment: "test", problem: null };
}

/** Entorno del despliegue, o null si no está declarado (ver `readVerifactuEnvironment`). */
export function getVerifactuEnvironment(env: Env = process.env): VerifactuEnvironment | null {
  return readVerifactuEnvironment(env).environment;
}

/** Entorno del despliegue; falla con un mensaje claro si no está declarado. */
export function requireVerifactuEnvironment(env: Env = process.env): VerifactuEnvironment {
  const config = readVerifactuEnvironment(env);
  if (config.environment) return config.environment;
  throw new HttpError(503, `VERI*FACTU no está bien configurado en este servidor. ${config.problem} Avisa al administrador del sistema.`);
}

/**
 * Servicio web de remisión (SOAP, RegFactuSistemaFacturacion), según el WSDL de la AEAT: un punto
 * de acceso para certificados de persona o representante y otro para certificados de sello.
 */
export const AEAT_VERIFACTU_ENDPOINTS: Record<VerifactuEnvironment, { standard: string; seal: string }> = {
  production: {
    standard: "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    seal: "https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  },
  test: {
    standard: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
    seal: "https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  },
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

/** Punto de acceso de un envío: lo deciden el entorno DEL REGISTRO y el tipo de certificado que firma la conexión. */
export function getVerifactuEndpoint(target: { environment: VerifactuEnvironment; seal?: boolean }, env: Env = process.env) {
  const override = env.VERIFACTU_ENDPOINT_URL?.trim();
  if (override) return override;
  const urls = AEAT_VERIFACTU_ENDPOINTS[target.environment];
  return target.seal ? urls.seal : urls.standard;
}

/** URL base del cotejo del QR: la del entorno DEL REGISTRO, no la del despliegue que lo pinta. */
export function getQrBaseUrl(mode: "VERIFACTU" | "NO_VERIFACTU", environment: VerifactuEnvironment, env: Env = process.env) {
  const override = env.VERIFACTU_QR_BASE_URL?.trim();
  if (override) return override;
  const urls = AEAT_QR_BASE_URLS[environment];
  return mode === "VERIFACTU" ? urls.verifactu : urls.noVerifactu;
}

export type VerifactuTransportConfig =
  | { kind: "disabled"; reason: string }
  /**
   * `environment` es el del despliegue: solo se remiten los registros nacidos en él.
   * `certPath` es el certificado del sistema (null si cada empresa remite con el suyo) y
   * `certSeal` indica si ese certificado es de sello electrónico.
   */
  | { kind: "aeat"; environment: VerifactuEnvironment; certPath: string | null; certPassword: string; certSeal: boolean };

const NIF_FORMAT = /^[0-9A-Z][0-9]{7}[0-9A-Z]$/;

export function getVerifactuTransportConfig(env: Env = process.env): VerifactuTransportConfig {
  if (env.VERIFACTU_TRANSPORT !== "aeat") {
    return { kind: "disabled", reason: "El envío a la AEAT no está activado (VERIFACTU_TRANSPORT)." };
  }
  const environment = readVerifactuEnvironment(env);
  if (!environment.environment) return { kind: "disabled", reason: environment.problem };
  // Sin NIF del productor el bloque SistemaInformatico no es válido y la AEAT rechaza el envío entero.
  if (!NIF_FORMAT.test((env.VERIFACTU_PRODUCER_NIF ?? "").trim().toUpperCase())) {
    return { kind: "disabled", reason: "Falta el NIF del productor del sistema informático (VERIFACTU_PRODUCER_NIF)." };
  }
  return {
    kind: "aeat",
    environment: environment.environment,
    certPath: env.VERIFACTU_CERT_PATH?.trim() || null,
    certPassword: env.VERIFACTU_CERT_PASSWORD ?? "",
    certSeal: ["s", "si", "sí", "true", "1"].includes(env.VERIFACTU_CERT_SEAL?.trim().toLowerCase() ?? ""),
  };
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
    NombreRazon: clean(env.VERIFACTU_PRODUCER_NAME, "Norpie", 120),
    NIF: clean(env.VERIFACTU_PRODUCER_NIF, "", 9).toUpperCase(),
    NombreSistemaInformatico: clean(env.VERIFACTU_SYSTEM_NAME, "Norpie", 30),
    IdSistemaInformatico: clean(env.VERIFACTU_SYSTEM_ID, "ES", 2),
    Version: clean(env.VERIFACTU_SYSTEM_VERSION, "0.1.0", 50),
    NumeroInstalacion: clean(env.VERIFACTU_INSTALLATION_NUMBER, installationKey, 100),
    // Solo se puede usar como VERI*FACTU: no se ofrece la modalidad de registros firmados sin remisión.
    TipoUsoPosibleSoloVerifactu: "S",
    TipoUsoPosibleMultiOT: "S",
    IndicadorMultiplesOT: env.VERIFACTU_MULTI_OT?.trim().toUpperCase() === "N" ? "N" : "S",
  };
}
