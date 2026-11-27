import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { certificateValidity } from "@/server/verifactu/certificates";
import {
  getQrBaseUrl,
  getVerifactuEndpoint,
  getVerifactuEnvironment,
  getVerifactuTransportConfig,
  readVerifactuEnvironment,
  requireVerifactuEnvironment,
  type VerifactuTransportConfig,
} from "@/server/verifactu/config";
import { mustRegisterAt } from "@/server/verifactu/hooks";
import { flowControlWaitMs } from "@/server/verifactu/sender";
import { buildVerifactuHealth, type VerifactuHealthInput } from "@/server/verifactu/service";
import { assertValidVerifactuSince } from "@/server/verifactu/settings";
import { endpointForSend } from "@/server/verifactu/transport";

describe("VeriFactu · entorno del despliegue", () => {
  it("takes an explicit environment as is", () => {
    expect(getVerifactuEnvironment({ VERIFACTU_ENVIRONMENT: "production" })).toBe("production");
    expect(getVerifactuEnvironment({ VERIFACTU_ENVIRONMENT: " Test " })).toBe("test");
  });

  it("has no default when sending is enabled or in a production build", () => {
    expect(readVerifactuEnvironment({ VERIFACTU_TRANSPORT: "aeat" })).toMatchObject({ environment: null, problem: expect.stringContaining("VERIFACTU_ENVIRONMENT") });
    expect(readVerifactuEnvironment({ NODE_ENV: "production" }).environment).toBeNull();
    expect(() => requireVerifactuEnvironment({ NODE_ENV: "production" })).toThrowError(expect.objectContaining({ status: 503 }));
    // Solo en desarrollo, sin envío, se asume pruebas.
    expect(getVerifactuEnvironment({ NODE_ENV: "development" })).toBe("test");
    expect(getVerifactuEnvironment({})).toBe("test");
  });

  it("never guesses from a mistyped value (it used to fall back silently to test)", () => {
    for (const value of ["prod", "producción", "PRODUCTION ", "live"]) {
      const config = readVerifactuEnvironment({ VERIFACTU_ENVIRONMENT: value });
      if (value.trim().toLowerCase() === "production") expect(config.environment).toBe("production");
      else expect(config).toMatchObject({ environment: null, problem: expect.stringContaining("no válido") });
    }
  });

  it("keeps the transport disabled, with the reason, until the environment is declared", () => {
    const base = { VERIFACTU_TRANSPORT: "aeat", VERIFACTU_PRODUCER_NIF: "B00000000" };
    expect(getVerifactuTransportConfig(base)).toMatchObject({ kind: "disabled", reason: expect.stringContaining("VERIFACTU_ENVIRONMENT") });
    expect(getVerifactuTransportConfig({ ...base, VERIFACTU_ENVIRONMENT: "production" })).toMatchObject({ kind: "aeat", environment: "production", certSeal: false });
    expect(getVerifactuTransportConfig({ ...base, VERIFACTU_ENVIRONMENT: "test", VERIFACTU_CERT_SEAL: "S" })).toMatchObject({ kind: "aeat", environment: "test", certSeal: true });
  });
});

describe("VeriFactu · punto de acceso por registro y certificado", () => {
  it("uses the AEAT endpoints of the WSDL: standard and seal, production and test", () => {
    expect(getVerifactuEndpoint({ environment: "production" }, {})).toBe("https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP");
    expect(getVerifactuEndpoint({ environment: "production", seal: true }, {})).toBe("https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP");
    expect(getVerifactuEndpoint({ environment: "test" }, {})).toBe("https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP");
    expect(getVerifactuEndpoint({ environment: "test", seal: true }, {})).toBe("https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP");
    expect(getVerifactuEndpoint({ environment: "production" }, { VERIFACTU_ENDPOINT_URL: "https://simulador.local/ws" })).toBe("https://simulador.local/ws");
  });

  it("derives the QR host from the given environment, not from the process", () => {
    expect(getQrBaseUrl("VERIFACTU", "production", { VERIFACTU_ENVIRONMENT: "test" })).toBe("https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR");
    expect(getQrBaseUrl("VERIFACTU", "test", { VERIFACTU_ENVIRONMENT: "production" })).toBe("https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR");
  });

  const config = (overrides: Partial<Extract<VerifactuTransportConfig, { kind: "aeat" }>> = {}) =>
    ({ kind: "aeat" as const, environment: "production" as const, certPath: "/run/sistema.p12", certPassword: "", certSeal: false, ...overrides });
  const credentials = (seal: boolean) => ({ pfx: Buffer.from("x"), passphrase: "", seal });

  it("picks the seal endpoint per send, from the certificate that signs the connection", () => {
    expect(endpointForSend(config(), credentials(true), { environment: "production" }, {})).toContain("//www10.");
    expect(endpointForSend(config(), credentials(false), { environment: "production" }, {})).toContain("//www1.");
    // Sin certificado de empresa manda el del sistema.
    expect(endpointForSend(config({ certSeal: true }), null, { environment: "production" }, {})).toContain("//www10.");
    expect(endpointForSend(config({ certSeal: true }), credentials(false), { environment: "production" }, {})).toContain("//www1.");
    expect(endpointForSend(config({ environment: "test" }), credentials(true), { environment: "test" }, {})).toContain("//prewww10.");
  });

  it("refuses to send records of another environment", () => {
    expect(() => endpointForSend(config(), null, { environment: "test" }, {})).toThrow(/entorno «test»/);
    expect(() => endpointForSend(config({ environment: "test" }), null, { environment: "production" }, {})).toThrow(/entorno «production»/);
  });
});

describe("VeriFactu · registro según el instante real de emisión", () => {
  const since = new Date("2027-01-01T00:00:00Z");

  it("decides by the moment the invoice is issued", () => {
    expect(mustRegisterAt(null, new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(mustRegisterAt(since, new Date("2026-12-31T23:59:59Z"))).toBe(false);
    expect(mustRegisterAt(since, since)).toBe(true);
    expect(mustRegisterAt(since, new Date("2027-03-01T00:00:00Z"))).toBe(true);
  });

  it("validates the start date: not before the Order, not more than a year ahead", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(() => assertValidVerifactuSince(null, now)).not.toThrow();
    expect(() => assertValidVerifactuSince(new Date("2027-01-01T00:00:00Z"), now)).not.toThrow();
    expect(() => assertValidVerifactuSince(new Date("2026-01-01T00:00:00Z"), now)).not.toThrow();
    expect(() => assertValidVerifactuSince(new Date("2072-01-01T00:00:00Z"), now)).toThrowError(expect.objectContaining({ status: 422 }));
    expect(() => assertValidVerifactuSince(new Date("2020-01-01T00:00:00Z"), now)).toThrow(/28-10-2024/);
    expect(() => assertValidVerifactuSince(new Date("nope"), now)).toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe("VeriFactu · control de flujo", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("waits the time the AEAT asked for since the previous submission (60 s until it says otherwise)", () => {
    expect(flowControlWaitMs(null, now)).toBe(0);
    expect(flowControlWaitMs({ lastSubmissionAt: null, waitSeconds: 120 }, now)).toBe(0);
    expect(flowControlWaitMs({ lastSubmissionAt: ago(20), waitSeconds: null }, now)).toBe(40_000);
    expect(flowControlWaitMs({ lastSubmissionAt: ago(60), waitSeconds: null }, now)).toBe(0);
    expect(flowControlWaitMs({ lastSubmissionAt: ago(90), waitSeconds: 300 }, now)).toBe(210_000);
    expect(flowControlWaitMs({ lastSubmissionAt: ago(301), waitSeconds: 300 }, now)).toBe(0);
  });

  it("lets a full batch go without waiting (whichever comes first)", () => {
    expect(flowControlWaitMs({ lastSubmissionAt: ago(5), waitSeconds: 300 }, now, 999)).toBe(295_000);
    expect(flowControlWaitMs({ lastSubmissionAt: ago(5), waitSeconds: 300 }, now, 1000)).toBe(0);
  });
});

describe("VeriFactu · avisos de salud", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  const healthy: VerifactuHealthInput = {
    mode: "verifactu",
    environment: "production",
    environmentProblem: null,
    readiness: { operational: true, reason: null, certificate: "company" },
    certificate: { validTo: new Date("2028-01-01T00:00:00Z") },
    overduePending: 0,
    oldestPendingAt: null,
    rejected: 0,
    otherEnvironmentPending: 0,
    now,
  };
  const codes = (input: Partial<VerifactuHealthInput>) => buildVerifactuHealth({ ...healthy, ...input }).issues.map((issue) => issue.code);

  it("reports nothing when everything is fine", () => {
    expect(buildVerifactuHealth(healthy)).toMatchObject({ ok: true, active: true, issues: [] });
  });

  it("always shows the test-environment label, as a warning", () => {
    const health = buildVerifactuHealth({ ...healthy, environment: "test" });
    expect(health.issues).toEqual([expect.objectContaining({ code: "TEST_ENVIRONMENT", tone: "warning", title: "ENTORNO DE PRUEBAS" })]);
    expect(health.ok).toBe(true);
    // Sin VERI*FACTU activo no hay registros que rotular.
    expect(codes({ environment: "test", mode: "pending" })).toEqual([]);
  });

  it("flags a missing environment as a blocking problem", () => {
    const health = buildVerifactuHealth({ ...healthy, environment: null, environmentProblem: "Falta VERIFACTU_ENVIRONMENT." });
    expect(health.ok).toBe(false);
    expect(health.issues[0]).toMatchObject({ code: "ENVIRONMENT_MISSING", tone: "danger", message: expect.stringContaining("Falta VERIFACTU_ENVIRONMENT.") });
  });

  it("reports unsent records with their count and the date of the oldest", () => {
    const health = buildVerifactuHealth({ ...healthy, overduePending: 3, oldestPendingAt: new Date("2026-11-25T08:30:00Z") });
    expect(health.ok).toBe(false);
    // Hora peninsular (08:30 UTC → 9:30); el separador entre fecha y hora depende de la versión de ICU.
    expect(health.issues[0]).toMatchObject({ code: "PENDING_OVERDUE", title: expect.stringMatching(/^3 registros sin remitir desde el 25 de noviembre de 2026.{1,10}9:30$/) });
  });

  it("reports rejections, and pending records of another environment", () => {
    expect(codes({ rejected: 2 })).toEqual(["REJECTED"]);
    expect(buildVerifactuHealth({ ...healthy, otherEnvironmentPending: 1 }).issues[0]).toMatchObject({ code: "OTHER_ENVIRONMENT", title: "1 registro pendiente del entorno de pruebas" });
  });

  it("tells apart a missing, an expired and an expiring certificate", () => {
    expect(codes({ readiness: { operational: false, reason: "La empresa no ha subido su certificado electrónico.", certificate: null, cause: "certificate-missing" }, certificate: null })).toEqual(["CERTIFICATE_MISSING"]);
    const expired = { validTo: new Date("2026-11-01T00:00:00Z") };
    expect(certificateValidity(expired.validTo, now).expired).toBe(true);
    expect(codes({ readiness: { operational: false, reason: "El certificado caducó.", certificate: "company", cause: "certificate-expired" }, certificate: expired })).toEqual(["CERTIFICATE_EXPIRED"]);
    const expiring = buildVerifactuHealth({ ...healthy, certificate: { validTo: new Date("2026-12-07T10:00:00Z") } });
    expect(expiring.issues).toEqual([expect.objectContaining({ code: "CERTIFICATE_EXPIRING", tone: "warning", title: "El certificado electrónico caduca en 10 días" })]);
    expect(expiring.ok).toBe(true);
    // A más de 30 días no se avisa.
    expect(codes({ certificate: { validTo: new Date("2027-01-15T00:00:00Z") } })).toEqual([]);
    expect(codes({ readiness: { operational: false, reason: "El envío a la AEAT no está activado (VERIFACTU_TRANSPORT).", certificate: null, cause: "transport" }, certificate: null })).toEqual(["TRANSPORT_OFF"]);
  });

  it("flags the legacy NO VERI*FACTU mode", () => {
    expect(codes({ mode: "non_verifactu" })).toEqual(["LEGACY_MODE"]);
  });
});
