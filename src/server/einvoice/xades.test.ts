import { createHash, generateKeyPairSync, verify as cryptoVerify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildFacturaeXml, FACTURAE_NAMESPACE, XMLDSIG_NAMESPACE } from "@/server/einvoice/facturae";
import { extractSigningMaterial, findKeyBags, Pkcs12Error } from "@/server/einvoice/pkcs12";
import { baseInvoice } from "@/server/einvoice/test-fixtures";
import { FACTURAE_POLICY_SHA1, FACTURAE_POLICY_URL, signFacturae, signingTimeString, verifyFacturaeSignature, XADES_NAMESPACE, XadesError } from "@/server/einvoice/xades";

/**
 * Certificados autofirmados de usar y tirar (contraseña «secreto»), sin valor fuera de los tests:
 * - RSA 2048 (el tipo habitual de los certificados españoles), generado con OpenSSL para estos tests.
 * - El de pruebas de VERI*FACTU, que es de curva elíptica (P-256).
 */
const readPfx = (...path: string[]) => Buffer.from(readFileSync(join(__dirname, ...path), "utf8").trim(), "base64");
const pfx = readPfx("test-fixtures", "certificado-rsa-de-prueba.p12.b64");
const ecPfx = readPfx("..", "verifactu", "test-fixtures", "certificado-de-prueba.p12.b64");
const material = extractSigningMaterial(pfx, "secreto");
const ecMaterial = extractSigningMaterial(ecPfx, "secreto");
const signingTime = new Date("2026-11-27T12:00:00Z");
const unsigned = buildFacturaeXml(baseInvoice()).xml;
const signed = signFacturae(unsigned, { privateKey: material.privateKey, certificateDer: material.certificateDer, signingTime });
const ecSigned = signFacturae(unsigned, { privateKey: ecMaterial.privateKey, certificateDer: ecMaterial.certificateDer, signingTime });

const NAMESPACES = ` xmlns:ds="${XMLDSIG_NAMESPACE}" xmlns:fe="${FACTURAE_NAMESPACE}" xmlns:xades="${XADES_NAMESPACE}"`;
const between = (text: string, open: string, close: string) => text.slice(text.indexOf(open), text.indexOf(close) + close.length);
const sha512 = (text: string) => createHash("sha512").update(text, "utf8").digest("base64");

describe("PKCS#12: clave privada y certificado para firmar", () => {
  it("extrae la clave que corresponde al certificado del titular", () => {
    expect(material.certificate.subject).toContain("CN=00000000T ANA PRUEBA (R: B12345674)");
    expect(material.privateKey.asymmetricKeyType).toBe("rsa");
    expect(ecMaterial.certificate.subject).toContain("CN=00000000T ANA PRUEBA (R: B12345678)");
    expect(ecMaterial.privateKey.asymmetricKeyType).toBe("ec");
    expect(findKeyBags(pfx).bags).toHaveLength(1);
  });

  it("explica el fallo con contraseña errónea o fichero que no es un certificado", () => {
    expect(() => extractSigningMaterial(pfx, "otra")).toThrow(Pkcs12Error);
    expect(() => extractSigningMaterial(Buffer.from("esto no es un certificado"), "secreto")).toThrow(/No se pudo abrir el certificado/);
  });
});

describe("XAdES-EPES de Facturae", () => {
  it("la firma verifica", () => {
    const verification = verifyFacturaeSignature(signed);
    expect(verification.errors).toEqual([]);
    expect(verification.valid).toBe(true);
    expect(verification.subject).toContain("ANA PRUEBA");
    expect(verification.signingTime).toBe("2026-11-27T13:00:00+01:00");
  });

  it("verifica con node:crypto calculando la forma canónica a mano, sin el verificador del módulo", () => {
    // 1) Firma del SignedInfo canónico (con los espacios de nombres heredados) con la clave pública del certificado incrustado.
    const signedInfo = between(signed, "<ds:SignedInfo>", "</ds:SignedInfo>");
    const canonicalSignedInfo = signedInfo.replace("<ds:SignedInfo>", `<ds:SignedInfo${NAMESPACES}>`);
    const signatureValue = /<ds:SignatureValue Id="[^"]+">([^<]+)<\/ds:SignatureValue>/.exec(signed)![1];
    const certificate = new X509Certificate(Buffer.from(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/.exec(signed)![1], "base64"));
    expect(certificate.raw.equals(material.certificateDer)).toBe(true);
    expect(cryptoVerify("sha512", Buffer.from(canonicalSignedInfo, "utf8"), certificate.publicKey, Buffer.from(signatureValue, "base64"))).toBe(true);

    // 2) Las tres huellas: documento sin firma, SignedProperties y KeyInfo.
    const digests = [...signedInfo.matchAll(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>/g)].map((match) => match[1]);
    expect(digests).toHaveLength(3);
    const signature = between(signed, "<ds:Signature ", "</ds:Signature>");
    const documentWithoutSignature = signed.replace(signature, "").replace('<?xml version="1.0" encoding="UTF-8"?>', "");
    expect(`<?xml version="1.0" encoding="UTF-8"?>${documentWithoutSignature}`).toBe(unsigned);
    expect(digests[0]).toBe(sha512(documentWithoutSignature));
    const signedProperties = between(signed, "<xades:SignedProperties ", "</xades:SignedProperties>");
    expect(digests[1]).toBe(sha512(signedProperties.replace("<xades:SignedProperties", `<xades:SignedProperties${NAMESPACES}`)));
    const keyInfo = between(signed, "<ds:KeyInfo ", "</ds:KeyInfo>");
    expect(digests[2]).toBe(sha512(keyInfo.replace("<ds:KeyInfo", `<ds:KeyInfo${NAMESPACES}`)));
  });

  it("es «enveloped»: la firma es el último hijo de la raíz y referencia el documento, las propiedades y el certificado", () => {
    expect(signed.endsWith("</ds:Signature></fe:Facturae>")).toBe(true);
    expect(signed).toContain('<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315">');
    expect(signed).toContain('<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha512">');
    expect(signed).toMatch(/<ds:Reference Id="Reference-[0-9a-f]+" URI=""><ds:Transforms><ds:Transform Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#enveloped-signature">/);
    expect(signed).toMatch(/<ds:Reference Type="http:\/\/uri\.etsi\.org\/01903#SignedProperties" URI="#SignedProperties-[0-9a-f]+">/);
    expect(signed).toMatch(/<ds:Reference URI="#KeyInfo-[0-9a-f]+">/);
    expect(signed).toMatch(/<xades:QualifyingProperties Target="#Signature-[0-9a-f]+">/);
  });

  it("declara la política de firma de Facturae 3.1, el certificado firmante y el rol «supplier»", () => {
    expect(signed).toContain(`<xades:Identifier>${FACTURAE_POLICY_URL}</xades:Identifier>`);
    expect(signed).toContain(`<xades:SigPolicyHash><ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod><ds:DigestValue>${FACTURAE_POLICY_SHA1}</ds:DigestValue></xades:SigPolicyHash>`);
    expect(signed).toContain("<xades:ClaimedRole>supplier</xades:ClaimedRole>");
    expect(signed).toContain("<xades:SigningTime>2026-11-27T13:00:00+01:00</xades:SigningTime>");
    const certDigest = /<xades:CertDigest>.*?<ds:DigestValue>([^<]+)<\/ds:DigestValue><\/xades:CertDigest>/.exec(signed)![1];
    expect(certDigest).toBe(createHash("sha512").update(material.certificateDer).digest("base64"));
    expect(signed).toContain(`<ds:X509SerialNumber>${BigInt(`0x${material.certificate.serialNumber}`).toString(10)}</ds:X509SerialNumber>`);
    // Emisor en orden RFC 2253: el nombre común primero, el país al final.
    const issuerName = /<ds:X509IssuerName>([^<]+)<\/ds:X509IssuerName>/.exec(signed)![1];
    expect(issuerName.startsWith("CN=")).toBe(true);
    expect(issuerName.endsWith("C=ES")).toBe(true);
  });

  it("detecta cualquier cambio posterior a la firma", () => {
    const changedAmount = signed.replace("<InvoiceTotal>440.86</InvoiceTotal>", "<InvoiceTotal>40.86</InvoiceTotal>");
    expect(verifyFacturaeSignature(changedAmount).valid).toBe(false);
    expect(verifyFacturaeSignature(changedAmount).errors[0]).toContain("contenido de la factura");
    const changedTime = signed.replace("2026-11-27T13:00:00+01:00", "2026-11-28T13:00:00+01:00");
    expect(verifyFacturaeSignature(changedTime).valid).toBe(false);
    const signatureValue = /<ds:SignatureValue Id="[^"]+">([^<]+)</.exec(signed)![1];
    const flipped = `${signatureValue[0] === "A" ? "B" : "A"}${signatureValue.slice(1)}`;
    expect(verifyFacturaeSignature(signed.replace(signatureValue, flipped)).valid).toBe(false);
    expect(verifyFacturaeSignature(unsigned).valid).toBe(false);
  });

  it("no acepta un certificado que no corresponde a la clave", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => signFacturae(unsigned, { privateKey: other.privateKey, certificateDer: material.certificateDer, signingTime })).toThrow(XadesError);
  });

  it("solo firma documentos en la forma canónica que genera la aplicación", () => {
    expect(() => signFacturae(signed, { privateKey: material.privateKey, certificateDer: material.certificateDer })).toThrow(/ya está firmado/);
    expect(() => signFacturae(unsigned.replace("<FileHeader>", "\n  <FileHeader>"), { privateKey: material.privateKey, certificateDer: material.certificateDer })).toThrow(XadesError);
    expect(() => signFacturae("<Invoice></Invoice>", { privateKey: material.privateKey, certificateDer: material.certificateDer })).toThrow(XadesError);
  });

  it("firma y verifica también con clave de curva elíptica (ECDSA-SHA512)", () => {
    expect(ecSigned).toContain('<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512">');
    expect(verifyFacturaeSignature(ecSigned)).toMatchObject({ valid: true, errors: [] });
    // Comprobación independiente: r||s (IEEE P1363) sobre el SignedInfo canónico.
    const signedInfo = between(ecSigned, "<ds:SignedInfo>", "</ds:SignedInfo>").replace("<ds:SignedInfo>", `<ds:SignedInfo${NAMESPACES}>`);
    const value = Buffer.from(/<ds:SignatureValue Id="[^"]+">([^<]+)</.exec(ecSigned)![1], "base64");
    expect(value).toHaveLength(64);
    expect(cryptoVerify("sha512", Buffer.from(signedInfo, "utf8"), { key: ecMaterial.certificate.publicKey, dsaEncoding: "ieee-p1363" }, value)).toBe(true);
    expect(verifyFacturaeSignature(ecSigned.replace("<InvoiceTotal>440.86</InvoiceTotal>", "<InvoiceTotal>440.87</InvoiceTotal>")).valid).toBe(false);
  });

  it("fecha de firma con el desfase horario peninsular (verano e invierno)", () => {
    expect(signingTimeString(new Date("2026-07-01T10:30:15Z"))).toBe("2026-07-01T12:30:15+02:00");
    expect(signingTimeString(new Date("2026-12-31T23:30:15.900Z"))).toBe("2027-01-01T00:30:15+01:00");
  });
});
