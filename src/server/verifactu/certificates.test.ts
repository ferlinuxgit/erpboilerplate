import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  certificateSubjectNifs,
  certificateValidity,
  getSystemCertificateInfo,
  getVerifactuReadiness,
  readPfxCertificate,
  reviewCertificate,
  subjectLooksLikeSeal,
  type CertificateDetails,
} from "@/server/verifactu/certificates";

/**
 * Certificado autofirmado de usar y tirar (no vale para nada fuera de este test), generado con
 * OpenSSL: titular «00000000T ANA PRUEBA (R: B12345678)», organizationIdentifier VATES-B12345678,
 * válido del 27-11-2026 al 03-11-2126, contraseña «secreto».
 */
const pfx = Buffer.from(readFileSync(join(__dirname, "test-fixtures", "certificado-de-prueba.p12.b64"), "utf8").trim(), "base64");
const DURING = new Date("2027-01-15T12:00:00Z");

describe("VeriFactu · lectura del certificado (PKCS#12 → X.509)", () => {
  it("reads subject, validity and the NIFs of the holder", () => {
    const details = readPfxCertificate(pfx, "secreto");
    expect(details.subject).toContain("O=EMPRESA SL");
    expect(details.subject).toContain("CN=00000000T ANA PRUEBA (R: B12345678)");
    expect(details.validTo?.toISOString().slice(0, 10)).toBe("2126-11-03");
    expect(details.validFrom?.toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(details.nifs).toEqual(expect.arrayContaining(["B12345678", "00000000T"]));
    expect(details.looksLikeSeal).toBe(false);
  });

  it("fails with a clear message when the password is wrong or the file is not a PKCS#12", () => {
    expect(() => readPfxCertificate(pfx, "otra")).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => readPfxCertificate(Buffer.from("esto no es un certificado"), "secreto")).toThrow(/No se pudo abrir el certificado/);
  });

  it("extracts NIFs from the usual Spanish subject layouts and ignores plain numbers", () => {
    expect(certificateSubjectNifs("CN=EMPRESA SL, organizationIdentifier=VATES-B12345678, serialNumber=IDCES-12345678Z")).toEqual(["B12345678", "12345678Z"]);
    expect(certificateSubjectNifs("CN=NOMBRE APELLIDO APELLIDO - NIF 12345678Z")).toEqual(["12345678Z"]);
    expect(certificateSubjectNifs("CN=SERVIDOR 123456789, O=ACME")).toEqual([]);
  });

  it("recognises electronic seal certificates by their subject", () => {
    expect(subjectLooksLikeSeal("CN=SELLO ELECTRONICO DE EMPRESA SL, OU=SELLO ELECTRONICO, organizationIdentifier=VATES-B12345678")).toBe(true);
    expect(subjectLooksLikeSeal("CN=Qualified e-Seal ACME, OU=Electronic Seal")).toBe(true);
    expect(subjectLooksLikeSeal("CN=00000000T ANA PRUEBA (R: B12345678), O=SEALAND SL")).toBe(false);
  });
});

describe("VeriFactu · revisión del certificado al subirlo", () => {
  const details = readPfxCertificate(pfx, "secreto");

  it("accepts a valid certificate of the company without warnings", () => {
    expect(reviewCertificate(details, "B12345678", DURING)).toEqual([]);
    // El NIF de la empresa puede venir con prefijo de país o separadores.
    expect(reviewCertificate(details, "ES-B12345678", DURING)).toEqual([]);
  });

  it("warns (without blocking) when the holder is not the company", () => {
    const warnings = reviewCertificate(details, "B99999999", DURING);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("B99999999");
    expect(warnings[0]).toContain("representante o apoderado");
  });

  it("rejects expired and not-yet-valid certificates", () => {
    expect(() => reviewCertificate(details, "B12345678", new Date("2127-01-01T00:00:00Z"))).toThrowError(expect.objectContaining({ status: 422, message: expect.stringContaining("caducó") }));
    expect(() => reviewCertificate(details, "B12345678", new Date("2026-01-01T00:00:00Z"))).toThrow(/todavía no es válido/);
  });

  it("warns when the certificate expires within 30 days", () => {
    const soon = reviewCertificate(details, "B12345678", new Date("2126-10-20T00:00:00Z"));
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatch(/caduca el 3 de noviembre de 2126/);
    expect(reviewCertificate(details, "B12345678", new Date("2126-09-01T00:00:00Z"))).toEqual([]);
  });

  it("warns when the X.509 could not be read, so expiry cannot be watched", () => {
    const unreadable: CertificateDetails = { subject: null, validFrom: null, validTo: null, nifs: [], looksLikeSeal: false };
    expect(reviewCertificate(unreadable, "B12345678", DURING)[0]).toContain("no podremos avisarte");
  });

  it("computes expiry state, treating an unknown date as not expired", () => {
    const validTo = new Date("2027-03-01T00:00:00Z");
    expect(certificateValidity(validTo, new Date("2027-01-01T00:00:00Z"))).toMatchObject({ expired: false, expiringSoon: false, daysLeft: 59 });
    expect(certificateValidity(validTo, new Date("2027-02-10T00:00:00Z"))).toMatchObject({ expired: false, expiringSoon: true, daysLeft: 19 });
    expect(certificateValidity(validTo, new Date("2027-03-01T00:00:01Z"))).toMatchObject({ expired: true, expiringSoon: false });
    expect(certificateValidity(null, DURING)).toEqual({ expired: false, expiringSoon: false, daysLeft: null });
  });
});

describe("VeriFactu · certificado del sistema (VERIFACTU_CERT_PATH)", () => {
  const dir = mkdtempSync(join(tmpdir(), "verifactu-system-cert-"));
  const certPath = join(dir, "sistema.p12");
  writeFileSync(certPath, pfx);
  const env = { VERIFACTU_TRANSPORT: "aeat", VERIFACTU_ENVIRONMENT: "test", VERIFACTU_PRODUCER_NIF: "B12345678", VERIFACTU_CERT_PATH: certPath, VERIFACTU_CERT_PASSWORD: "secreto" };
  // La empresa no ha subido certificado propio.
  const noOwnCertificate = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as never;

  it("lee su titular y su caducidad, igual que el de una empresa", async () => {
    const info = await getSystemCertificateInfo(env);
    expect(info).toMatchObject({ readable: true });
    expect(info?.subject).toContain("O=EMPRESA SL");
    expect(info?.validTo?.toISOString().slice(0, 10)).toBe("2126-11-03");
  });

  it("no hay certificado del sistema sin ruta o sin envío activado", async () => {
    expect(await getSystemCertificateInfo({ ...env, VERIFACTU_CERT_PATH: "" })).toBeNull();
    expect(await getSystemCertificateInfo({ ...env, VERIFACTU_TRANSPORT: "disabled" })).toBeNull();
  });

  it("un fichero que no existe o una contraseña incorrecta se informan como ilegibles, sin fallar", async () => {
    expect(await getSystemCertificateInfo({ ...env, VERIFACTU_CERT_PATH: join(dir, "no-existe.p12") })).toEqual({ subject: null, validTo: null, readable: false });
    expect(await getSystemCertificateInfo({ ...env, VERIFACTU_CERT_PASSWORD: "otra" })).toMatchObject({ readable: false });
  });

  it("vigente: la empresa sin certificado propio remite con el del sistema", async () => {
    await expect(getVerifactuReadiness(noOwnCertificate, "company-1", env, DURING)).resolves.toMatchObject({ operational: true, certificate: "system" });
  });

  it("caducado: el envío deja de estar operativo, como con el certificado de la empresa", async () => {
    const readiness = await getVerifactuReadiness(noOwnCertificate, "company-1", env, new Date("2126-12-01T00:00:00Z"));
    expect(readiness).toMatchObject({ operational: false, certificate: "system", cause: "certificate-expired" });
    expect(readiness.reason).toMatch(/certificado electrónico del sistema caducó/);
  });
});
