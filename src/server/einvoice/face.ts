import { createHash, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";

import { HttpError } from "@/lib/http";
import { el, serializeXml, txt, XML_DECLARATION, type XmlNode } from "@/server/einvoice/xml";

/**
 * Cliente del servicio web de FACe para proveedores (`facturasspp2`): remitir una factura, consultar
 * su estado y solicitar su anulación. Construcción del sobre SOAP firmado y lectura de respuestas:
 * código puro salvo el transporte HTTPS, que es intercambiable (los tests usan uno falso).
 *
 * Fuentes contrastadas (descargadas el 27-11-2026):
 * - WSDL vigentes de producción y de pruebas: https://webservice.face.gob.es/facturasspp2?wsdl y
 *   https://se-face-webservice.redsara.es/facturasspp2?wsdl. Estilo rpc/literal, espacio de
 *   nombres `https://webservice.face.gob.es` en ambos, SOAPAction `https://webservice.face.gob.es#<operación>`.
 *   Operaciones usadas: `enviarFactura(request: EnviarFacturaRequest)`, `consultarFactura(numeroRegistro)`
 *   y `anularFactura(numeroRegistro, motivo)`.
 * - «Servicios para sistemas automatizados de proveedores» de FACe (manual v1.2.3, 03-11-2014):
 *   las peticiones van firmadas según OASIS WS-Security 1.0 X.509 Token Profile, con el certificado
 *   en `wsse:BinarySecurityToken`, la firma en `wsse:Security` y un `wsu:Timestamp` (apéndices A y
 *   F: IncludeTimestamp, SignedParts Body); el sistema del proveedor debe darse de alta antes en
 *   face.gob.es con la parte pública del certificado que firmará (capítulo 2); la factura es un
 *   Facturae firmado `.xsig` con mime «application/xml» (4.2.1.1); estados de tramitación
 *   1200–3100 y de anulación 4100–4400 (apéndice B).
 *
 * Firma: se firman el `wsu:Timestamp` y el `soapenv:Body` con canonicalización exclusiva
 * (xml-exc-c14n, la del ejemplo del manual), huellas SHA-512 y RSA-SHA512 (ECDSA-SHA512 con clave
 * de curva elíptica). El ejemplo del manual usa SHA-1, ya retirado; SHA-512 es el algoritmo que
 * usan las integraciones en uso con FACe (p. ej. la librería libre josemmo/Facturae-PHP) y el
 * mismo de la firma del Facturae. Como en `xades.ts`, no hay canonicalizador general: los
 * fragmentos firmados se generan ya en su forma canónica exclusiva (declaraciones de espacio de
 * nombres utilizadas, en el propio elemento raíz del fragmento, ordenadas por prefijo).
 *
 * SIN VERIFICAR (nada se ha enviado a FACe, ni siquiera al entorno de pruebas, que exige dar de
 * alta el certificado):
 * - Que FACe acepte esta firma tal cual (algoritmos SHA-512, orden de los elementos de
 *   `wsse:Security`). La firma sí se ha verificado con una implementación independiente (Java
 *   XML Digital Signature) durante el desarrollo.
 * - Los códigos de `resultado` del servicio `facturasspp2` no están documentados en el manual (que
 *   describe el servicio anterior `sspp`): el éxito se reconoce por la presencia del número de
 *   registro o de los datos de la factura, y en otro caso se muestra el código y la descripción.
 * - No se verifica la firma de las RESPUESTAS de FACe (se confía en la conexión TLS con el host
 *   oficial); el manual publica certificados de 2014, ya caducados.
 */

export const FACE_ENVIRONMENTS = ["production", "staging"] as const;
export type FaceEnvironment = (typeof FACE_ENVIRONMENTS)[number];

export const faceEnvironmentLabels: Record<FaceEnvironment, string> = { production: "producción", staging: "pruebas (STAGING)" };

/** Direcciones de los WSDL (`soap:address`). */
export const FACE_ENDPOINTS: Record<FaceEnvironment, string> = {
  production: "https://webservice.face.gob.es/facturasspp2",
  staging: "https://se-face-webservice.redsara.es/facturasspp2",
};

export const FACE_NAMESPACE = "https://webservice.face.gob.es";
const SOAPENV = "http://schemas.xmlsoap.org/soap/envelope/";
const WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
const WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
const DS = "http://www.w3.org/2000/09/xmldsig#";
const BASE64_BINARY = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";
const X509V3 = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3";
const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const SHA512 = "http://www.w3.org/2001/04/xmlenc#sha512";
const RSA_SHA512 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512";
const ECDSA_SHA512 = "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512";
/** Validez de la petición (wsu:Expires). */
const REQUEST_LIFETIME_MS = 5 * 60 * 1000;

/** Estados de tramitación (apéndice B.1 del manual de FACe). */
export const faceProcessingLabels: Record<string, string> = {
  "1200": "Registrada en FACe",
  "1300": "Registrada en el registro contable de facturas",
  "2400": "Reconocida la obligación de pago",
  "2500": "Pagada",
  "2600": "Rechazada por la unidad",
  "3100": "Anulada",
};

/** Estados de anulación (apéndice B.2). */
export const faceCancellationLabels: Record<string, string> = {
  "4100": "Sin solicitud de anulación",
  "4200": "Anulación solicitada",
  "4300": "Anulación aceptada",
  "4400": "Anulación rechazada",
};

// ---------------------------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

export type FaceConfig =
  | { enabled: false; environment: null; problem: null }
  | { enabled: true; environment: FaceEnvironment; problem: null }
  | { enabled: true; environment: null; problem: string };

/**
 * Configuración de la remisión a FACe:
 * - FACE_TRANSPORT: «disabled» (por defecto: la factura se sube a mano en face.gob.es) o «face».
 * - FACE_ENVIRONMENT: «production» o «staging». OBLIGATORIA y SIN valor por defecto con
 *   FACE_TRANSPORT=face: una factura a una Administración enviada a pruebas no llega a nadie, y una
 *   de pruebas enviada a producción se registra de verdad.
 */
export function readFaceConfig(env: Env = process.env): FaceConfig {
  const transport = env.FACE_TRANSPORT?.trim().toLowerCase() ?? "";
  if (transport !== "face") return { enabled: false, environment: null, problem: null };
  const raw = env.FACE_ENVIRONMENT?.trim().toLowerCase() ?? "";
  if ((FACE_ENVIRONMENTS as readonly string[]).includes(raw)) return { enabled: true, environment: raw as FaceEnvironment, problem: null };
  return {
    enabled: true,
    environment: null,
    problem: raw
      ? `FACE_ENVIRONMENT tiene un valor no válido («${raw}»): debe ser «production» o «staging».`
      : "Falta FACE_ENVIRONMENT: con FACE_TRANSPORT=face hay que indicar de forma expresa «production» o «staging» (no hay valor por defecto).",
  };
}

/** Entorno de FACe del despliegue; falla con un mensaje claro si el envío no está activado o configurado. */
export function requireFaceEnvironment(env: Env = process.env): FaceEnvironment {
  const config = readFaceConfig(env);
  if (!config.enabled) throw new HttpError(409, "La remisión automática a FACe no está activada en este servidor: sube la factura firmada en face.gob.es.");
  if (!config.environment) throw new HttpError(503, `La remisión a FACe no está bien configurada en este servidor. ${config.problem} Avisa al administrador del sistema.`);
  return config.environment;
}

// ---------------------------------------------------------------------------------------------
// Sobre SOAP firmado
// ---------------------------------------------------------------------------------------------

export type FaceOperation = "enviarFactura" | "consultarFactura" | "anularFactura";

export type FaceSigningMaterial = { privateKey: KeyObject; certificateDer: Buffer };

export type FaceEnvelopeOptions = {
  now?: Date;
  /** Sufijo de los identificadores (por defecto, aleatorio). */
  id?: string;
};

const digest = (text: string) => createHash("sha512").update(Buffer.from(text, "utf8")).digest("base64");
/** Elemento vacío (en forma canónica, pareja de etiquetas). */
const empty = (name: string, attributes: XmlNode["attributes"]): XmlNode => ({ name, text: "", attributes });

/** Parámetros de la operación (rpc/literal: accesores sin espacio de nombres). */
function operationNode(operation: FaceOperation, parts: XmlNode[]): XmlNode {
  return el(`web:${operation}`, parts, { "xmlns:web": FACE_NAMESPACE });
}

export function enviarFacturaBody(input: { email: string; fileName: string; xsigBase64: string }): XmlNode {
  return operationNode("enviarFactura", [
    el("request", [
      txt("correo", input.email),
      el("factura", [txt("factura", input.xsigBase64), txt("nombre", input.fileName), txt("mime", "application/xml")]),
      // Sin anexos (son opcionales): elemento vacío.
      empty("anexos", undefined),
    ]),
  ]);
}

export function consultarFacturaBody(registryNumber: string): XmlNode {
  return operationNode("consultarFactura", [txt("numeroRegistro", registryNumber)].filter((node): node is XmlNode => Boolean(node)));
}

export function anularFacturaBody(registryNumber: string, reason: string): XmlNode {
  return operationNode("anularFactura", [txt("numeroRegistro", registryNumber), txt("motivo", reason)].filter((node): node is XmlNode => Boolean(node)));
}

/**
 * Sobre SOAP 1.1 con la cabecera WS-Security firmada. Los fragmentos firmados (Timestamp, Body y
 * SignedInfo) llevan en su etiqueta de apertura exactamente las declaraciones de espacio de nombres
 * que la canonicalización exclusiva les asigna, así que su texto ES su forma canónica.
 */
export function buildFaceEnvelope(operationBody: XmlNode, material: FaceSigningMaterial, options: FaceEnvelopeOptions = {}): string {
  const now = options.now ?? new Date();
  const id = options.id ?? randomBytes(8).toString("hex");
  const ids = { body: `Body-${id}`, timestamp: `TS-${id}`, token: `X509-${id}`, signature: `SIG-${id}`, keyInfo: `KI-${id}`, str: `STR-${id}` };
  const keyType = material.privateKey.asymmetricKeyType;
  if (keyType !== "rsa" && keyType !== "ec") throw new HttpError(422, "El certificado usa un tipo de clave que no se admite para firmar (se admite RSA y curva elíptica).");

  const body = serializeXml(el("soapenv:Body", [operationBody], { "xmlns:soapenv": SOAPENV, "xmlns:wsu": WSU, "wsu:Id": ids.body }));
  const timestamp = serializeXml(el("wsu:Timestamp", [
    txt("wsu:Created", now.toISOString()),
    txt("wsu:Expires", new Date(now.getTime() + REQUEST_LIFETIME_MS).toISOString()),
  ], { "xmlns:wsu": WSU, "wsu:Id": ids.timestamp }));

  const reference = (uri: string, fragment: string) => el("ds:Reference", [
    el("ds:Transforms", [empty("ds:Transform", { Algorithm: EXC_C14N })]),
    empty("ds:DigestMethod", { Algorithm: SHA512 }),
    txt("ds:DigestValue", digest(fragment)),
  ], { URI: `#${uri}` });
  const signedInfo = serializeXml(el("ds:SignedInfo", [
    empty("ds:CanonicalizationMethod", { Algorithm: EXC_C14N }),
    empty("ds:SignatureMethod", { Algorithm: keyType === "ec" ? ECDSA_SHA512 : RSA_SHA512 }),
    reference(ids.timestamp, timestamp),
    reference(ids.body, body),
  ], { "xmlns:ds": DS }));
  const toSign = Buffer.from(signedInfo, "utf8");
  const signatureValue = keyType === "ec"
    ? cryptoSign("sha512", toSign, { key: material.privateKey, dsaEncoding: "ieee-p1363" })
    : cryptoSign("sha512", toSign, material.privateKey);

  const token = serializeXml(txt("wsse:BinarySecurityToken", material.certificateDer.toString("base64"), { EncodingType: BASE64_BINARY, ValueType: X509V3, "wsu:Id": ids.token })!);
  const keyInfo = serializeXml(el("ds:KeyInfo", [
    el("wsse:SecurityTokenReference", [empty("wsse:Reference", { URI: `#${ids.token}`, ValueType: X509V3 })], { "wsu:Id": ids.str }),
  ], { Id: ids.keyInfo }));
  const signature = `<ds:Signature xmlns:ds="${DS}" Id="${ids.signature}">${signedInfo}<ds:SignatureValue>${signatureValue.toString("base64")}</ds:SignatureValue>${keyInfo}</ds:Signature>`;

  return `${XML_DECLARATION}<soapenv:Envelope xmlns:soapenv="${SOAPENV}">`
    + `<soapenv:Header><wsse:Security xmlns:wsse="${WSSE}" xmlns:wsu="${WSU}" soapenv:mustUnderstand="1">${token}${signature}${timestamp}</wsse:Security></soapenv:Header>`
    + `${body}</soapenv:Envelope>`;
}

export function faceSoapAction(operation: FaceOperation) {
  return `${FACE_NAMESPACE}#${operation}`;
}

// ---------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------

function decodeEntities(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Contenido del primer elemento con ese nombre local (cualquier prefijo), o null. Vacío si es `<x/>`. */
export function elementContent(xml: string, localName: string): string | null {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}\\s*>)`);
  const match = pattern.exec(xml);
  if (!match) return null;
  return match[1] ?? "";
}

function textOf(xml: string | null, localName: string): string | null {
  if (xml === null) return null;
  const content = elementContent(xml, localName);
  // Solo elementos de texto: si dentro hay otros elementos, no es el campo buscado.
  if (content === null || content.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").includes("<")) return null;
  const value = decodeEntities(content).trim();
  return value || null;
}

export type FaceResult = { code: string | null; description: string | null };
export type FaceState = { code: string; description: string | null; reason: string | null };

export type FaceResponse<T> = { ok: true; result: FaceResult; data: T } | { ok: false; result: FaceResult; error: string };

function resultOf(xml: string): FaceResult {
  const block = elementContent(xml, "resultado");
  return { code: textOf(block, "codigo"), description: textOf(block, "descripcion") };
}

/** Error genérico: fallo SOAP, HTTP o respuesta sin los datos esperados. */
function failure<T>(xml: string, httpStatus: number, fallback: string): FaceResponse<T> {
  const fault = textOf(xml, "faultstring");
  const result = resultOf(xml);
  const detail = fault ?? (result.code || result.description ? [result.code, result.description].filter(Boolean).join(" · ") : null);
  return { ok: false, result, error: detail ? `FACe respondió: ${detail}` : `${fallback} (HTTP ${httpStatus}).` };
}

export type FaceSubmission = { registryNumber: string; receivedAt: string | null; accountingOffice: string | null; managingBody: string | null; processingUnit: string | null };

export function parseEnviarFacturaResponse(xml: string, httpStatus = 200): FaceResponse<FaceSubmission> {
  const factura = elementContent(elementContent(xml, "return") ?? xml, "factura");
  const registryNumber = textOf(factura, "numeroRegistro");
  if (!registryNumber) return failure(xml, httpStatus, "FACe no devolvió el número de registro");
  return {
    ok: true,
    result: resultOf(xml),
    data: {
      registryNumber,
      receivedAt: textOf(factura, "fechaRecepcion"),
      accountingOffice: textOf(factura, "oficinaContable"),
      managingBody: textOf(factura, "organoGestor"),
      processingUnit: textOf(factura, "unidadTramitadora"),
    },
  };
}

function stateOf(block: string | null): FaceState | null {
  const code = textOf(block, "codigo");
  return code ? { code, description: textOf(block, "descripcion"), reason: textOf(block, "motivo") } : null;
}

export function parseConsultarFacturaResponse(xml: string, httpStatus = 200): FaceResponse<{ processing: FaceState | null; cancellation: FaceState | null }> {
  const factura = elementContent(elementContent(xml, "return") ?? xml, "factura");
  const processing = stateOf(factura === null ? null : elementContent(factura, "tramitacion"));
  const cancellation = stateOf(factura === null ? null : elementContent(factura, "anulacion"));
  if (!processing && !cancellation) return failure(xml, httpStatus, "FACe no devolvió el estado de la factura");
  return { ok: true, result: resultOf(xml), data: { processing, cancellation } };
}

export function parseAnularFacturaResponse(xml: string, httpStatus = 200): FaceResponse<{ registryNumber: string; message: string | null }> {
  const factura = elementContent(elementContent(xml, "return") ?? xml, "factura");
  const registryNumber = textOf(factura, "numeroRegistro");
  if (!registryNumber) return failure(xml, httpStatus, "FACe no confirmó la solicitud de anulación");
  return { ok: true, result: resultOf(xml), data: { registryNumber, message: textOf(factura, "mensaje") } };
}

// ---------------------------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------------------------

export interface FaceTransport {
  readonly kind: string;
  send(request: { environment: FaceEnvironment; operation: FaceOperation; envelope: string }): Promise<{ httpStatus: number; body: string }>;
}

/** Transporte HTTPS real (la autenticación va en la firma WS-Security, no en la conexión). */
export function createFaceHttpsTransport(timeoutMs = 60_000): FaceTransport {
  return {
    kind: "face",
    async send({ environment, operation, envelope }) {
      const response = await fetch(FACE_ENDPOINTS[environment], {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${faceSoapAction(operation)}"` },
        body: envelope,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { httpStatus: response.status, body: await response.text() };
    },
  };
}
