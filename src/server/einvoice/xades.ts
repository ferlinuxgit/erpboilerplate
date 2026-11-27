import { createHash, createPublicKey, sign as cryptoSign, verify as cryptoVerify, X509Certificate, type KeyObject } from "node:crypto";

import { FACTURAE_NAMESPACE, XMLDSIG_NAMESPACE } from "@/server/einvoice/facturae";
import { el, escapeXmlText, serializeXml, txt, XML_DECLARATION, type XmlNode } from "@/server/einvoice/xml";

/**
 * Firma XAdES-EPES «enveloped» de un Facturae, conforme a la política de firma de Facturae v3.1
 * (https://www.facturae.gob.es/politica_de_firma_formato_facturae/politica_de_firma_formato_facturae_v3_1.pdf),
 * que es la que exige FACe. Solo usa `node:crypto`.
 *
 * Qué se firma (apartado 1.3 de la política), con tres referencias en `ds:SignedInfo`:
 *   1. El documento entero (URI="") con la transformación «enveloped-signature».
 *   2. `xades:SignedProperties` (fecha, certificado, política y rol «supplier»).
 *   3. `ds:KeyInfo`, para que no se pueda sustituir el certificado.
 *
 * Algoritmos: canonicalización Canonical XML 1.0 (http://www.w3.org/TR/2001/REC-xml-c14n-20010315),
 * que es la que define XMLDSig —la política solo admite «los algoritmos definidos en el estándar
 * XMLDSig»— y la que usan las implementaciones que FACe acepta; huellas SHA-512; firma RSA-SHA512
 * (o ECDSA-SHA512 si la clave es de curva elíptica). XAdES 1.3.2.
 *
 * CANONICALIZACIÓN SIN LIBRERÍA. No se usa un canonicalizador general: el XML lo genera `xml.ts`
 * directamente en forma canónica (léanse sus restricciones), así que:
 *   - La forma canónica del documento sin la firma es el propio texto sin la declaración `<?xml?>`.
 *   - La de un fragmento firmado (SignedInfo, SignedProperties, KeyInfo) es su texto con las
 *     declaraciones de espacio de nombres heredadas (`ds`, `fe`, `xades`) añadidas a su etiqueta de
 *     apertura, en orden alfabético de prefijo y antes de los atributos.
 * Por eso `signFacturae` SOLO acepta documentos producidos por `buildFacturaeXml`: comprueba la
 * raíz exacta y rechaza cualquier otro XML (con espacios entre nodos, comentarios, otro orden de
 * atributos…), cuya forma canónica no sabría calcular. `verifyFacturaeSignature` tiene la misma
 * limitación: verifica las firmas hechas aquí, no firmas XAdES arbitrarias.
 *
 * Huella de la política: la política v3.1 se identifica por su URL histórica y por el SHA-1 del
 * PDF publicado entonces («Ohixl6upD6av8N7pEvDABhEL6hM=»), que es el valor que comprueban los
 * validadores. El PDF que hoy sirve facturae.gob.es tiene otros bytes (otro SHA-1), así que no se
 * recalcula: se usa el valor fijo.
 *
 * No incluye sello de tiempo ni información de revocación (eso sería XAdES-T / XAdES-XL): FACe solo
 * exige XAdES-EPES.
 */

export const XADES_NAMESPACE = "http://uri.etsi.org/01903/v1.3.2#";
export const FACTURAE_POLICY_URL = "http://www.facturae.es/politica_de_firma_formato_facturae/politica_de_firma_formato_facturae_v3_1.pdf";
export const FACTURAE_POLICY_SHA1 = "Ohixl6upD6av8N7pEvDABhEL6hM=";
const POLICY_DESCRIPTION = "Política de Firma FacturaE v3.1";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const SHA512 = "http://www.w3.org/2001/04/xmlenc#sha512";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const RSA_SHA512 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512";
const ECDSA_SHA512 = "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const SIGNED_PROPERTIES_TYPE = "http://uri.etsi.org/01903#SignedProperties";

const ROOT_OPEN = `<fe:Facturae xmlns:ds="${XMLDSIG_NAMESPACE}" xmlns:fe="${FACTURAE_NAMESPACE}">`;
const ROOT_CLOSE = "</fe:Facturae>";
/** Espacios de nombres en vigor dentro de `ds:Signature`, ya en orden canónico (por prefijo). */
const INHERITED_NAMESPACES = ` xmlns:ds="${XMLDSIG_NAMESPACE}" xmlns:fe="${FACTURAE_NAMESPACE}" xmlns:xades="${XADES_NAMESPACE}"`;

export class XadesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XadesError";
  }
}

const sha512 = (data: string | Buffer) => createHash("sha512").update(data).digest("base64");

/** Forma canónica de un fragmento cuyo elemento raíz es `<prefijo:Nombre …>`: se le añaden los espacios heredados. */
function canonicalFragment(fragment: string, tag: string) {
  const open = `<${tag}`;
  if (!fragment.startsWith(open)) throw new XadesError(`Fragmento inesperado: se esperaba ${tag}.`);
  return `${open}${INHERITED_NAMESPACES}${fragment.slice(open.length)}`;
}

/** Fecha y hora de la firma con desfase horario de Madrid (xsd:dateTime), como el ejemplo de la política. */
export function signingTimeString(date: Date, timeZone = "Europe/Madrid") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((local - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.trunc(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/**
 * Nombre del emisor del certificado en el orden de RFC 2253 (del más específico al más general).
 * Node lo entrega en el orden del certificado, un componente por línea y ya escapado.
 */
export function issuerNameRfc2253(certificate: X509Certificate) {
  return certificate.issuer.split("\n").map((part) => part.trim()).filter(Boolean).reverse().join(",");
}

function signatureAlgorithm(key: KeyObject) {
  if (key.asymmetricKeyType === "rsa") return RSA_SHA512;
  if (key.asymmetricKeyType === "ec") return ECDSA_SHA512;
  throw new XadesError("El certificado usa un tipo de clave que no se admite para firmar (se admite RSA y curva elíptica).");
}

const ds = (name: string, children: Array<XmlNode | null>, attributes?: XmlNode["attributes"]) => el(`ds:${name}`, children, attributes);
/** Elemento sin contenido (se serializa como pareja de etiquetas, que es su forma canónica). */
const algorithm = (name: string, uri: string) => ({ name: `ds:${name}`, text: "", attributes: { Algorithm: uri } }) satisfies XmlNode;

export type SignFacturaeOptions = {
  privateKey: KeyObject;
  /** Certificado del firmante en DER. */
  certificateDer: Buffer;
  signingTime?: Date;
  /** Sufijo de los identificadores de la firma (por defecto, derivado del documento y la fecha). */
  id?: string;
};

/** Añade `ds:Signature` (XAdES-EPES) como último hijo de la raíz de un Facturae generado por `buildFacturaeXml`. */
export function signFacturae(unsignedXml: string, options: SignFacturaeOptions): string {
  const body = unsignedXml.startsWith(XML_DECLARATION) ? unsignedXml.slice(XML_DECLARATION.length) : unsignedXml;
  if (!body.startsWith(ROOT_OPEN) || !body.endsWith(ROOT_CLOSE)) {
    throw new XadesError("Solo se pueden firmar los Facturae generados por la aplicación (forma canónica conocida).");
  }
  if (body.includes("<ds:Signature")) throw new XadesError("El documento ya está firmado.");
  if (/>\s+</.test(body) || body.includes("<!--") || body.includes("<?")) throw new XadesError("El documento no está en la forma canónica esperada.");

  const certificate = new X509Certificate(options.certificateDer);
  const keyPublic = createPublicKey(options.privateKey).export({ type: "spki", format: "der" });
  if (!keyPublic.equals(certificate.publicKey.export({ type: "spki", format: "der" }))) {
    throw new XadesError("La clave privada no corresponde al certificado.");
  }
  const signingTime = options.signingTime ?? new Date();
  const id = options.id ?? createHash("sha256").update(body).update(String(signingTime.getTime())).digest("hex").slice(0, 16);
  const ids = {
    signature: `Signature-${id}`,
    signatureValue: `SignatureValue-${id}`,
    signedProperties: `SignedProperties-${id}`,
    keyInfo: `KeyInfo-${id}`,
    documentReference: `Reference-${id}`,
  };

  const keyInfo = serializeXml(ds("KeyInfo", [ds("X509Data", [txt("ds:X509Certificate", options.certificateDer.toString("base64"))])], { Id: ids.keyInfo }));

  const signedProperties = serializeXml(el("xades:SignedProperties", [
    el("xades:SignedSignatureProperties", [
      txt("xades:SigningTime", signingTimeString(signingTime)),
      el("xades:SigningCertificate", [el("xades:Cert", [
        el("xades:CertDigest", [algorithm("DigestMethod", SHA512), txt("ds:DigestValue", sha512(options.certificateDer))]),
        el("xades:IssuerSerial", [
          txt("ds:X509IssuerName", issuerNameRfc2253(certificate)),
          txt("ds:X509SerialNumber", BigInt(`0x${certificate.serialNumber}`).toString(10)),
        ]),
      ])]),
      el("xades:SignaturePolicyIdentifier", [el("xades:SignaturePolicyId", [
        el("xades:SigPolicyId", [txt("xades:Identifier", FACTURAE_POLICY_URL), txt("xades:Description", POLICY_DESCRIPTION)]),
        el("xades:SigPolicyHash", [algorithm("DigestMethod", SHA1), txt("ds:DigestValue", FACTURAE_POLICY_SHA1)]),
      ])]),
      // Firma el emisor de la factura: rol «supplier» (apartado 1.3 de la política).
      el("xades:SignerRole", [el("xades:ClaimedRoles", [txt("xades:ClaimedRole", "supplier")])]),
    ]),
    el("xades:SignedDataObjectProperties", [el("xades:DataObjectFormat", [
      txt("xades:Description", "Factura electrónica"),
      txt("xades:MimeType", "text/xml"),
    ], { ObjectReference: `#${ids.documentReference}` })]),
  ], { Id: ids.signedProperties }));

  const reference = (digest: string, attributes: XmlNode["attributes"], enveloped = false) => ds("Reference", [
    enveloped ? ds("Transforms", [algorithm("Transform", ENVELOPED)]) : null,
    algorithm("DigestMethod", SHA512),
    txt("ds:DigestValue", digest),
  ], attributes);

  const signedInfo = serializeXml(ds("SignedInfo", [
    algorithm("CanonicalizationMethod", C14N),
    algorithm("SignatureMethod", signatureAlgorithm(options.privateKey)),
    // 1) El documento completo: sin la firma, su forma canónica es `body` tal cual.
    reference(sha512(Buffer.from(body, "utf8")), { Id: ids.documentReference, URI: "" }, true),
    reference(sha512(Buffer.from(canonicalFragment(signedProperties, "xades:SignedProperties"), "utf8")), { Type: SIGNED_PROPERTIES_TYPE, URI: `#${ids.signedProperties}` }),
    reference(sha512(Buffer.from(canonicalFragment(keyInfo, "ds:KeyInfo"), "utf8")), { URI: `#${ids.keyInfo}` }),
  ]));

  const toSign = Buffer.from(canonicalFragment(signedInfo, "ds:SignedInfo"), "utf8");
  const signatureValue = options.privateKey.asymmetricKeyType === "ec"
    ? cryptoSign("sha512", toSign, { key: options.privateKey, dsaEncoding: "ieee-p1363" })
    : cryptoSign("sha512", toSign, options.privateKey);

  const signature = `<ds:Signature xmlns:xades="${XADES_NAMESPACE}" Id="${ids.signature}">`
    + signedInfo
    + `<ds:SignatureValue Id="${ids.signatureValue}">${signatureValue.toString("base64")}</ds:SignatureValue>`
    + keyInfo
    + `<ds:Object><xades:QualifyingProperties Target="#${ids.signature}">${signedProperties}</xades:QualifyingProperties></ds:Object>`
    + "</ds:Signature>";

  return `${XML_DECLARATION}${body.slice(0, -ROOT_CLOSE.length)}${signature}${ROOT_CLOSE}`;
}

/** Documento sin la firma (lo que se firmó), o null si no tiene la estructura esperada. */
export function unsignedFacturae(signedXml: string): string | null {
  const start = signedXml.indexOf("<ds:Signature ");
  const close = "</ds:Signature>";
  const end = signedXml.lastIndexOf(close);
  if (start < 0 || end < start) return null;
  return `${signedXml.slice(0, start)}${signedXml.slice(end + close.length)}`;
}

export type SignatureVerification = {
  valid: boolean;
  errors: string[];
  /** Titular del certificado con el que se firmó. */
  subject: string | null;
  signingTime: string | null;
};

function slice(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start);
  return end < 0 ? null : text.slice(start, end + close.length);
}

function inner(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`).exec(text);
  return match ? match[1] : null;
}

/**
 * Comprueba una firma hecha por `signFacturae`: las tres huellas, la firma del `SignedInfo` con la
 * clave pública del certificado incrustado y que ese certificado es el declarado en
 * `SigningCertificate`. No valida la cadena de confianza ni la revocación del certificado (eso lo
 * hace el receptor: FACe consulta a @firma).
 */
export function verifyFacturaeSignature(signedXml: string): SignatureVerification {
  const errors: string[] = [];
  const result = (subject: string | null = null, signingTime: string | null = null): SignatureVerification => ({ valid: errors.length === 0, errors, subject, signingTime });

  const body = signedXml.startsWith(XML_DECLARATION) ? signedXml.slice(XML_DECLARATION.length) : signedXml;
  const signature = slice(body, "<ds:Signature ", "</ds:Signature>");
  if (!body.startsWith(ROOT_OPEN) || !body.endsWith(ROOT_CLOSE) || !signature) {
    errors.push("El documento no contiene una firma con la estructura esperada.");
    return result();
  }
  if (body.indexOf("<ds:Signature ", body.indexOf(signature) + 1) >= 0) errors.push("El documento tiene más de una firma.");
  const signedInfo = slice(signature, "<ds:SignedInfo>", "</ds:SignedInfo>");
  const keyInfo = slice(signature, "<ds:KeyInfo ", "</ds:KeyInfo>");
  const signedProperties = slice(signature, "<xades:SignedProperties ", "</xades:SignedProperties>");
  const signatureValue = inner(signature, "ds:SignatureValue");
  const certificateBase64 = keyInfo ? inner(keyInfo, "ds:X509Certificate") : null;
  if (!signedInfo || !keyInfo || !signedProperties || !signatureValue || !certificateBase64) {
    errors.push("Faltan partes de la firma (SignedInfo, KeyInfo, SignedProperties o SignatureValue).");
    return result();
  }

  const references = [...signedInfo.matchAll(/<ds:Reference([^>]*)>.*?<ds:DigestValue>([^<]*)<\/ds:DigestValue><\/ds:Reference>/g)]
    .map((match) => ({ uri: /URI="([^"]*)"/.exec(match[1])?.[1] ?? null, digest: match[2] }));
  const digestFor = (uri: string) => references.find((entry) => entry.uri === uri)?.digest ?? null;
  const idOf = (fragment: string) => /^<[^>]* Id="([^"]*)"/.exec(fragment)?.[1] ?? "";

  const unsignedBody = body.replace(signature, "");
  if (digestFor("") !== sha512(Buffer.from(unsignedBody, "utf8"))) errors.push("El contenido de la factura no coincide con lo firmado.");
  if (digestFor(`#${idOf(signedProperties)}`) !== sha512(Buffer.from(canonicalFragment(signedProperties, "xades:SignedProperties"), "utf8"))) {
    errors.push("Las propiedades firmadas (fecha, política, certificado) no coinciden con lo firmado.");
  }
  if (digestFor(`#${idOf(keyInfo)}`) !== sha512(Buffer.from(canonicalFragment(keyInfo, "ds:KeyInfo"), "utf8"))) errors.push("El certificado incrustado no coincide con lo firmado.");
  if (references.length !== 3) errors.push("La firma no cubre exactamente las tres referencias que exige la política de Facturae.");

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(Buffer.from(certificateBase64, "base64"));
  } catch {
    errors.push("El certificado incrustado en la firma no se puede leer.");
    return result();
  }
  const declaredDigest = inner(slice(signedProperties, "<xades:CertDigest>", "</xades:CertDigest>") ?? "", "ds:DigestValue");
  if (declaredDigest !== sha512(certificate.raw)) errors.push("El certificado declarado en SigningCertificate no es el incrustado.");
  if (!signedProperties.includes(`<xades:Identifier>${escapeXmlText(FACTURAE_POLICY_URL)}</xades:Identifier>`)) errors.push("La firma no declara la política de firma de Facturae.");

  const method = /<ds:SignatureMethod Algorithm="([^"]*)">/.exec(signedInfo)?.[1];
  const data = Buffer.from(canonicalFragment(signedInfo, "ds:SignedInfo"), "utf8");
  const value = Buffer.from(signatureValue, "base64");
  let signatureOk = false;
  try {
    signatureOk = method === ECDSA_SHA512
      ? cryptoVerify("sha512", data, { key: certificate.publicKey, dsaEncoding: "ieee-p1363" }, value)
      : method === RSA_SHA512 && cryptoVerify("sha512", data, certificate.publicKey, value);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) errors.push("El valor de la firma no es válido para el certificado incrustado.");

  return result(certificate.subject.split("\n").join(", "), inner(signedProperties, "xades:SigningTime"));
}
