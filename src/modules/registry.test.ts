import { describe, expect, it } from "vitest";

import { activeDependents, isModuleVisible, MODULE_IDS, MODULES, missingDependencies, moduleForPath, resolveEnabledModules } from "@/modules/registry";

describe("module registry", () => {
  it("declares every module id once, with routes and a main page inside them", () => {
    expect(MODULES.map((manifest) => manifest.id)).toEqual([...MODULE_IDS]);
    for (const manifest of MODULES) {
      expect(manifest.routes.length).toBeGreaterThan(0);
      expect(moduleForPath(manifest.href)?.id, manifest.id).toBe(manifest.id);
    }
  });

  it("maps pages and APIs to their module and leaves the core alone", () => {
    expect(moduleForPath("/inventory/count")?.id).toBe("inventory");
    expect(moduleForPath("/api/stock-movements?x=1")?.id).toBe("inventory");
    expect(moduleForPath("/sales/delivery-notes/abc")?.id).toBe("inventory");
    expect(moduleForPath("/sales/quotes/abc")?.id).toBe("sales-documents");
    expect(moduleForPath("/api/sepa/direct-debits")?.id).toBe("banking");
    expect(moduleForPath("/expenses/inbox")?.id).toBe("invoice-reading");
    expect(moduleForPath("/crm/opportunities")?.id).toBe("crm");
    expect(moduleForPath("/api/pos/sessions")?.id).toBe("pos");
    for (const core of ["/invoices", "/expenses", "/expenses/new", "/api/expenses", "/accounting", "/fiscal", "/settings", "/settings/modules", "/modules/crm", "/dashboard", "/customers", "/purchases/payments"]) {
      expect(moduleForPath(core), core).toBeNull();
    }
  });

  it("keeps the item catalog, bank accounts and stored OCR originals in the core", () => {
    expect(moduleForPath("/inventory/items")).toBeNull();
    expect(moduleForPath("/inventory/items/new")).toBeNull();
    expect(moduleForPath("/treasury/bank-accounts/123")).toBeNull();
    expect(moduleForPath("/api/expenses/ocr/job-1/file")).toBeNull();
    expect(moduleForPath("/api/expenses/ocr/job-1")?.id).toBe("invoice-reading");
    // Prefijo de segmento completo: /crmx no es del CRM.
    expect(moduleForPath("/crmx")).toBeNull();
  });

  it("enables by default what the company sells and respects explicit choices", () => {
    expect(resolveEnabledModules([], "services")).not.toContain("inventory");
    expect(resolveEnabledModules([], "products")).toContain("inventory");
    expect(resolveEnabledModules([], null)).toEqual(["sales-documents", "purchase-orders", "inventory", "banking", "invoice-reading"]);
    const chosen = resolveEnabledModules([{ moduleId: "inventory", enabled: true }, { moduleId: "banking", enabled: false }, { moduleId: "crm", enabled: true }, { moduleId: "desconocido", enabled: true }], "services");
    expect(chosen).toEqual(["sales-documents", "purchase-orders", "inventory", "invoice-reading", "crm"]);
  });

  it("checks dependencies both ways", () => {
    expect(missingDependencies("crm", [])).toEqual([]);
    expect(activeDependents("inventory", ["inventory", "pos"])).toEqual([]);
  });

  it("shows tagged entries only when the module is enabled (or still unknown)", () => {
    expect(isModuleVisible(undefined, [])).toBe(true);
    expect(isModuleVisible("crm", null)).toBe(true);
    expect(isModuleVisible("crm", ["pos"])).toBe(false);
    expect(isModuleVisible("crm", ["crm"])).toBe(true);
  });
});
