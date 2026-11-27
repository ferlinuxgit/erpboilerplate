import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { verifactuAlertText } from "@/components/layout/verifactu-health-banner";
import { buildVerifactuAlert } from "@/server/verifactu/alert";
import { buildVerifactuHealth } from "@/server/verifactu/service";

const quiet = { mode: "verifactu" as const, overduePending: 0, rejected: 0, expiredCertificate: null };

describe("VeriFactu · aviso global", () => {
  it("no avisa si todo va bien ni en empresas sin VERI*FACTU activo", () => {
    expect(buildVerifactuAlert(quiet)).toBeNull();
    expect(buildVerifactuAlert({ ...quiet, mode: "pending", overduePending: 3, rejected: 2, expiredCertificate: "company" })).toBeNull();
  });

  it("avisa de los tres problemas graves con enlace a Fiscalidad › VERI*FACTU", () => {
    const alert = buildVerifactuAlert({ ...quiet, overduePending: 2, rejected: 1, expiredCertificate: "company" });
    expect(alert?.href).toBe("/fiscal/verifactu");
    expect(alert?.problems).toEqual([
      "tu certificado electrónico está caducado",
      "1 factura rechazada por la AEAT",
      "2 facturas llevan más de una hora sin enviarse a la AEAT",
    ]);
    expect(verifactuAlertText(alert?.problems ?? [])).toBe("VERI*FACTU: tu certificado electrónico está caducado, 1 factura rechazada por la AEAT y 2 facturas llevan más de una hora sin enviarse a la AEAT.");
  });

  it("distingue el certificado del sistema del de la empresa", () => {
    expect(buildVerifactuAlert({ ...quiet, expiredCertificate: "system" })?.problems).toEqual(["el certificado electrónico del sistema está caducado"]);
    expect(verifactuAlertText(["1 factura lleva más de una hora sin enviarse a la AEAT"])).toBe("VERI*FACTU: 1 factura lleva más de una hora sin enviarse a la AEAT.");
  });
});

describe("VeriFactu · caducidad del certificado del sistema en el estado de salud", () => {
  const now = new Date("2027-01-15T12:00:00Z");
  const base = {
    mode: "verifactu" as const,
    environment: "production" as const,
    environmentProblem: null,
    overduePending: 0,
    oldestPendingAt: null,
    rejected: 0,
    otherEnvironmentPending: 0,
    now,
  };

  it("caducado: incidencia grave que remite al administrador o a subir el certificado propio", () => {
    const health = buildVerifactuHealth({
      ...base,
      readiness: { operational: false, reason: "caducó", certificate: "system", cause: "certificate-expired" },
      certificate: { validTo: new Date("2027-01-01T00:00:00Z") },
    });
    expect(health.ok).toBe(false);
    expect(health.issues).toEqual([expect.objectContaining({ code: "CERTIFICATE_EXPIRED", tone: "danger", title: "El certificado electrónico del sistema está caducado", message: expect.stringMatching(/administrador del sistema/) })]);
  });

  it("a punto de caducar: aviso con los días que quedan", () => {
    const health = buildVerifactuHealth({
      ...base,
      readiness: { operational: true, reason: null, certificate: "system" },
      certificate: { validTo: new Date("2027-01-25T12:00:00Z") },
    });
    expect(health.ok).toBe(true);
    expect(health.issues).toEqual([expect.objectContaining({ code: "CERTIFICATE_EXPIRING", tone: "warning", title: "El certificado electrónico del sistema caduca en 10 días" })]);
  });

  it("el de la empresa conserva sus textos", () => {
    const health = buildVerifactuHealth({
      ...base,
      readiness: { operational: true, reason: null, certificate: "company" },
      certificate: { validTo: new Date("2027-01-25T12:00:00Z") },
    });
    expect(health.issues[0]).toMatchObject({ title: "El certificado electrónico caduca en 10 días", message: expect.stringMatching(/Renuévalo y súbelo/) });
  });
});
