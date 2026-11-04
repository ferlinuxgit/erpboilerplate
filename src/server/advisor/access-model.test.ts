import { describe, expect, it } from "vitest";

import { normalizeAdvisorScopes } from "@/lib/advisor-scopes";
import { advisorAccessStatus, generateAdvisorPassword, isAccessUsableForSession, normalizeAdvisorEmail } from "@/server/advisor/access-model";

const now = new Date("2026-11-04T10:00:00.000Z");

describe("acceso del asesor", () => {
  it("calcula el estado: revocado gana a caducado", () => {
    expect(advisorAccessStatus({ revokedAt: null, expiresAt: null }, now)).toBe("ACTIVE");
    expect(advisorAccessStatus({ revokedAt: null, expiresAt: new Date("2026-11-05T00:00:00.000Z") }, now)).toBe("ACTIVE");
    expect(advisorAccessStatus({ revokedAt: null, expiresAt: new Date("2026-11-04T10:00:00.000Z") }, now)).toBe("EXPIRED");
    expect(advisorAccessStatus({ revokedAt: new Date("2026-11-01T00:00:00.000Z"), expiresAt: new Date("2026-01-01T00:00:00.000Z") }, now)).toBe("REVOKED");
  });

  it("invalida las sesiones abiertas antes de cambiar la contraseña", () => {
    const changed = new Date("2026-11-04T09:00:00.000Z");
    const access = { revokedAt: null, expiresAt: null, credentialsChangedAt: changed };
    expect(isAccessUsableForSession(access, new Date("2026-11-04T08:59:59.000Z"), now)).toBe(false);
    expect(isAccessUsableForSession(access, changed, now)).toBe(true);
    expect(isAccessUsableForSession({ ...access, revokedAt: now }, new Date("2026-11-04T09:30:00.000Z"), now)).toBe(false);
  });

  it("genera contraseñas legibles y distintas", () => {
    const password = generateAdvisorPassword();
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
    expect(password).not.toMatch(/[01OIl]/);
    expect(new Set(Array.from({ length: 20 }, () => generateAdvisorPassword())).size).toBe(20);
  });

  it("normaliza email y secciones", () => {
    expect(normalizeAdvisorEmail("  Gestor@Despacho.ES ")).toBe("gestor@despacho.es");
    expect(normalizeAdvisorScopes(["taxes", "sales", "hack", "sales", 3])).toEqual(["sales", "taxes"]);
    expect(normalizeAdvisorScopes("sales")).toEqual([]);
  });
});
