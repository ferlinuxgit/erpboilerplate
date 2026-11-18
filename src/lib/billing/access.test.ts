import { describe, expect, it } from "vitest";

import { billingDenial, computeBillingAccess, type BillingAccessInput } from "@/lib/billing/access";

const now = new Date("2026-12-01T10:00:00Z");
const days = (count: number) => new Date(now.getTime() + count * 86_400_000);
const base: BillingAccessInput = { enforced: true, trialEndsAt: days(5), billingExempt: false, suspendedAt: null, subscription: null };

describe("acceso según la suscripción", () => {
  it("sin cobro activo en la instalación, todo está permitido", () => {
    const access = computeBillingAccess({ ...base, enforced: false, trialEndsAt: days(-30) }, now);
    expect(access).toMatchObject({ state: "disabled", readOnly: false });
    expect(access.modules.has("pos")).toBe(true);
  });

  it("prueba en curso: todos los módulos; terminada: solo lectura y sin módulos", () => {
    expect(computeBillingAccess(base, now)).toMatchObject({ state: "trial", readOnly: false });
    expect(computeBillingAccess(base, now).modules.has("hospitality")).toBe(true);
    const expired = computeBillingAccess({ ...base, trialEndsAt: days(-1) }, now);
    expect(expired).toMatchObject({ state: "trial_expired", readOnly: true });
    expect(expired.modules.size).toBe(0);
  });

  it("suscripción activa: el plan base y solo los módulos contratados, aunque la prueba siga", () => {
    const access = computeBillingAccess({ ...base, subscription: { status: "ACTIVE", addons: ["banking", "nada"], pastDueSince: null, currentPeriodEndsAt: days(20) } }, now);
    expect(access).toMatchObject({ state: "active", readOnly: false });
    expect([...access.modules]).toEqual(["banking"]);
  });

  it("impago: gracia de 7 días con lo contratado; después, solo lectura", () => {
    const pastDue = (since: Date) => computeBillingAccess({ ...base, trialEndsAt: null, subscription: { status: "PAST_DUE", addons: ["pos"], pastDueSince: since, currentPeriodEndsAt: null } }, now);
    expect(pastDue(days(-3))).toMatchObject({ state: "grace", readOnly: false });
    expect(pastDue(days(-3)).modules.has("pos")).toBe(true);
    expect(pastDue(days(-8))).toMatchObject({ state: "past_due", readOnly: true });
  });

  it("cancelada: solo lectura; cortesía: todo; suspendida: nada", () => {
    expect(computeBillingAccess({ ...base, trialEndsAt: null, subscription: { status: "CANCELED", addons: [], pastDueSince: null, currentPeriodEndsAt: null } }, now)).toMatchObject({ state: "canceled", readOnly: true });
    expect(computeBillingAccess({ ...base, trialEndsAt: null, billingExempt: true }, now)).toMatchObject({ state: "exempt", readOnly: false });
    expect(computeBillingAccess({ ...base, suspendedAt: days(-1), suspendedReason: "spam" }, now)).toMatchObject({ state: "suspended", blocked: true, message: expect.stringContaining("spam") });
    // A medio contratar (cliente creado, sin pagar): sigue la prueba; terminada, «prueba terminada».
    const incomplete = (trialEndsAt: Date) => computeBillingAccess({ ...base, trialEndsAt, subscription: { status: "NONE", addons: [], pastDueSince: null, currentPeriodEndsAt: null } }, now);
    expect(incomplete(days(3)).state).toBe("trial");
    expect(incomplete(days(-3)).state).toBe("trial_expired");
  });
});

describe("peticiones en solo lectura", () => {
  const readOnly = computeBillingAccess({ ...base, trialEndsAt: days(-1) }, now);

  it("bloquea crear y modificar con 402, pero deja consultar, exportar, pagar y cambiar de empresa", () => {
    expect(billingDenial(readOnly, "/api/invoices", "POST")).toMatchObject({ status: 402 });
    expect(billingDenial(readOnly, "/api/invoices/1", "DELETE")?.status).toBe(402);
    expect(billingDenial(readOnly, "/api/invoices", "GET")).toBeNull();
    expect(billingDenial(readOnly, "/api/billing/checkout", "POST")).toBeNull();
    expect(billingDenial(readOnly, "/api/context/active", "PATCH")).toBeNull();
    expect(billingDenial(readOnly, "/api/expenses/export", "POST")).toBeNull();
    expect(billingDenial(readOnly, "/invoices/new", "GET")).toBeNull();
  });

  it("una cuenta suspendida no puede ni consultar", () => {
    const suspended = computeBillingAccess({ ...base, suspendedAt: days(-1) }, now);
    expect(billingDenial(suspended, "/api/invoices", "GET")?.status).toBe(403);
  });
});
