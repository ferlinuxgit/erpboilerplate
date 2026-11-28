import { createHash, verify as cryptoVerify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  anularFacturaBody,
  buildFaceEnvelope,
  consultarFacturaBody,
  elementContent,
  enviarFacturaBody,
  FACE_ENDPOINTS,
  faceSoapAction,
  parseAnularFacturaResponse,
  parseConsultarFacturaResponse,
  parseEnviarFacturaResponse,
  readFaceConfig,
  requireFaceEnvironment,
} from "@/server/einvoice/face";
import { extractSigningMaterial } from "@/server/einvoice/pkcs12";

const readPfx = (...path: string[]) => Buffer.from(readFileSync(join(__dirname, ...path), "utf8").trim(), "base64");
const material = extractSigningMaterial(readPfx("test-fixtures", "certificado-rsa-de-prueba.p12.b64"), "secreto");
const ecMaterial = extractSigningMaterial(readPfx("..", "verifactu", "test-fixtures", "certificado-de-prueba.p12.b64"), "secreto");
const NOW = new Date("2026-12-01T12:00:00.000Z");
const sha512 = (text: string) => createHash("sha512").update(text, "utf8").digest("base64");

/** Fragmento literal `<tag …>…</tag>` del sobre (los firmados están ya en forma canónica exclusiva). */
function fragment(xml: string, tag: string) {
  const start = xml.indexOf(`<${tag} `);
  const end = xml.indexOf(`</${tag}>`, start) + tag.length + 3;
  return xml.slice(start, end);
}

describe("FACe: configuración", () => {
  it("sin envío activado no exige entorno; activado, lo exige sin valor por defecto", () => {
    expect(readFaceConfig({})).toEqual({ enabled: false, environment: null, problem: null });
    expect(readFaceConfig({ FACE_TRANSPORT: "face", FACE_ENVIRONMENT: "staging" })).toEqual({ enabled: true, environment: "staging", problem: null });
    expect(readFaceConfig({ FACE_TRANSPORT: "face" }).problem).toContain("Falta FACE_ENVIRONMENT");
    expect(readFaceConfig({ FACE_TRANSPORT: "face", FACE_ENVIRONMENT: "test" }).problem).toContain("no válido");
    expect(() => requireFaceEnvironment({})).toThrow(/no está activada/);
    expect(() => requireFaceEnvironment({ FACE_TRANSPORT: "face" })).toThrow(/Falta FACE_ENVIRONMENT/);
    expect(requireFaceEnvironment({ FACE_TRANSPORT: "face", FACE_ENVIRONMENT: "production" })).toBe("production");
  });

  it("direcciones y acciones SOAP de los WSDL vigentes", () => {
    expect(FACE_ENDPOINTS).toEqual({ production: "https://webservice.face.gob.es/facturasspp2", staging: "https://se-face-webservice.redsara.es/facturasspp2" });
    expect(faceSoapAction("enviarFactura")).toBe("https://webservice.face.gob.es#enviarFactura");
  });
});

describe("FACe: sobre SOAP con WS-Security", () => {
  const envelope = buildFaceEnvelope(enviarFacturaBody({ email: "facturas@talleres.example", fileName: "F2026-000012.xsig", xsigBase64: "PEZhY3R1cmFlLz4=" }), material, { now: NOW, id: "1" });

  it("cuerpo rpc/literal de enviarFactura según el WSDL", () => {
    expect(fragment(envelope, "soapenv:Body")).toBe(
      '<soapenv:Body xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" wsu:Id="Body-1">'
      + '<web:enviarFactura xmlns:web="https://webservice.face.gob.es"><request><correo>facturas@talleres.example</correo>'
      + "<factura><factura>PEZhY3R1cmFlLz4=</factura><nombre>F2026-000012.xsig</nombre><mime>application/xml</mime></factura><anexos></anexos></request></web:enviarFactura></soapenv:Body>",
    );
  });

  it("firma el Timestamp y el Body con huellas SHA-512 y verifica con el certificado del token", () => {
    const timestamp = fragment(envelope, "wsu:Timestamp");
    expect(timestamp).toContain("<wsu:Created>2026-12-01T12:00:00.000Z</wsu:Created><wsu:Expires>2026-12-01T12:05:00.000Z</wsu:Expires>");
    const signedInfo = fragment(envelope, "ds:SignedInfo");
    const digests = [...signedInfo.matchAll(/<ds:Reference URI="#([^"]+)">.*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/g)].map((match) => [match[1], match[2]]);
    expect(digests).toEqual([["TS-1", sha512(timestamp)], ["Body-1", sha512(fragment(envelope, "soapenv:Body"))]]);
    expect(signedInfo).toContain('<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha512"></ds:SignatureMethod>');
    const token = elementContent(envelope, "BinarySecurityToken")!;
    const certificate = new X509Certificate(Buffer.from(token, "base64"));
    const value = Buffer.from(elementContent(envelope, "SignatureValue")!, "base64");
    expect(cryptoVerify("sha512", Buffer.from(signedInfo, "utf8"), certificate.publicKey, value)).toBe(true);
    expect(envelope).toContain('<wsse:Reference URI="#X509-1" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"></wsse:Reference>');
    expect(envelope).toContain('soapenv:mustUnderstand="1"');
  });

  it("con clave de curva elíptica firma ECDSA-SHA512 (r||s)", () => {
    const ec = buildFaceEnvelope(consultarFacturaBody("201600000001"), ecMaterial, { now: NOW, id: "2" });
    expect(ec).toContain("<web:consultarFactura xmlns:web=\"https://webservice.face.gob.es\"><numeroRegistro>201600000001</numeroRegistro></web:consultarFactura>");
    const signedInfo = fragment(ec, "ds:SignedInfo");
    const value = Buffer.from(elementContent(ec, "SignatureValue")!, "base64");
    expect(cryptoVerify("sha512", Buffer.from(signedInfo, "utf8"), { key: ecMaterial.certificate.publicKey, dsaEncoding: "ieee-p1363" }, value)).toBe(true);
    const cancel = buildFaceEnvelope(anularFacturaBody("201600000001", "Error en el importe & IVA"), material, { now: NOW, id: "3" });
    expect(cancel).toContain("<numeroRegistro>201600000001</numeroRegistro><motivo>Error en el importe &amp; IVA</motivo>");
  });
});

describe("FACe: respuestas", () => {
  const wrap = (inner: string) => `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="https://webservice.face.gob.es"><SOAP-ENV:Header/><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

  it("enviarFactura: número de registro y unidades", () => {
    const parsed = parseEnviarFacturaResponse(wrap("<ns1:enviarFacturaResponse><return><resultado><codigo>0</codigo><descripcion>Correcto</descripcion><codigoSeguimiento/></resultado><factura><numeroRegistro>REGAGE26e00001</numeroRegistro><organoGestor>L01280796</organoGestor><unidadTramitadora>L01280796</unidadTramitadora><oficinaContable>L01280796</oficinaContable><identificadorEmisor>B12345674</identificadorEmisor><numeroFactura>000012</numeroFactura><serieFactura>F2026-</serieFactura><fechaRecepcion>2026-12-01 13:00:00</fechaRecepcion></factura></return></ns1:enviarFacturaResponse>"));
    expect(parsed).toEqual({ ok: true, result: { code: "0", description: "Correcto" }, data: { registryNumber: "REGAGE26e00001", receivedAt: "2026-12-01 13:00:00", accountingOffice: "L01280796", managingBody: "L01280796", processingUnit: "L01280796" } });
  });

  it("errores: resultado sin factura y SOAP Fault", () => {
    expect(parseEnviarFacturaResponse(wrap("<ns1:enviarFacturaResponse><return><resultado><codigo>301</codigo><descripcion>Unidad &lt;no&gt; válida</descripcion></resultado><factura xsi:nil=\"true\"/></return></ns1:enviarFacturaResponse>"), 200))
      .toEqual({ ok: false, result: { code: "301", description: "Unidad <no> válida" }, error: "FACe respondió: 301 · Unidad <no> válida" });
    expect(parseConsultarFacturaResponse(wrap("<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Firma no válida</faultstring></SOAP-ENV:Fault>"), 500))
      .toMatchObject({ ok: false, error: "FACe respondió: Firma no válida" });
    expect(parseAnularFacturaResponse("no es xml", 502)).toMatchObject({ ok: false, error: "FACe no confirmó la solicitud de anulación (HTTP 502)." });
  });

  it("consultarFactura y anularFactura", () => {
    const state = parseConsultarFacturaResponse(wrap("<ns1:consultarFacturaResponse><return><resultado><codigo>0</codigo><descripcion>Correcto</descripcion></resultado><factura><numeroRegistro>REGAGE26e00001</numeroRegistro><tramitacion><codigo>2600</codigo><descripcion>Rechazada</descripcion><motivo>Falta el expediente</motivo></tramitacion><anulacion><codigo>4100</codigo><descripcion>No solicitada anulación</descripcion><motivo></motivo></anulacion></factura></return></ns1:consultarFacturaResponse>"));
    expect(state).toMatchObject({ ok: true, data: { processing: { code: "2600", description: "Rechazada", reason: "Falta el expediente" }, cancellation: { code: "4100", description: "No solicitada anulación", reason: null } } });
    const cancel = parseAnularFacturaResponse(wrap("<ns1:anularFacturaResponse><return><resultado><codigo>0</codigo><descripcion>Correcto</descripcion></resultado><factura><numeroRegistro>REGAGE26e00001</numeroRegistro><mensaje>Solicitada anulación</mensaje></factura></return></ns1:anularFacturaResponse>"));
    expect(cancel).toMatchObject({ ok: true, data: { registryNumber: "REGAGE26e00001", message: "Solicitada anulación" } });
  });
});
