import { describe, expect, it } from "vitest";

import { closeChecklistBlocker, evaluateCloseChecklist, type CloseChecklistFacts } from "@/server/accounting/close-checklist-model";

const clean: CloseChecklistFacts = {
  yearCode: "2026",
  lastVatReturn: { period: "2026-Q4", label: "4.º trimestre de 2026", reportId: "r-1", filed: true },
  draftSalesInvoices: 0,
  account555Cents: 0,
  pendingBankTransactions: 0,
  ledgerDifferenceCents: 0,
  depreciation: { assets: 0, pendingAssets: 0, pendingCents: 0, fixedAssetBalanceCents: 0 },
};

describe("comprobaciones antes del cierre del ejercicio", () => {
  it("todo correcto y sin inmovilizado: no hace falta motivo", () => {
    const checklist = evaluateCloseChecklist(clean);
    expect(checklist.items.map((item) => [item.id, item.status])).toEqual([
      ["vat-q4-filed", "ok"],
      ["draft-invoices", "ok"],
      ["bank-555", "ok"],
      ["ledger-balanced", "ok"],
      ["depreciation", "ok"],
    ]);
    expect(checklist.blocked).toBe(false);
    expect(checklist.requiresOverride).toBe(false);
    expect(closeChecklistBlocker(checklist, null)).toBeNull();
  });

  it("303 sin presentar, borradores y 555 con saldo exigen un motivo para cerrar", () => {
    const checklist = evaluateCloseChecklist({
      ...clean,
      lastVatReturn: { period: "2026-Q4", label: "4.º trimestre de 2026", reportId: null, filed: false },
      draftSalesInvoices: 1,
      account555Cents: -12_345,
      pendingBankTransactions: 2,
    });
    const byId = Object.fromEntries(checklist.items.map((item) => [item.id, item]));
    expect(byId["vat-q4-filed"].status).toBe("pending");
    expect(byId["vat-q4-filed"].href).toBe("/fiscal/new?code=303&period=2026-Q4");
    expect(byId["draft-invoices"].detail).toContain("1 factura en borrador");
    expect(byId["bank-555"].detail).toContain("123,45");
    expect(byId["bank-555"].detail).toContain("2 movimientos bancarios");
    expect(checklist.requiresOverride).toBe(true);
    expect(checklist.blocked).toBe(false);
    expect(closeChecklistBlocker(checklist, "")).toMatch(/indica el motivo/);
    expect(closeChecklistBlocker(checklist, "El 303 lo presenta la gestoría")).toBeNull();
  });

  it("un descuadre bloquea el cierre aunque se indique un motivo", () => {
    const checklist = evaluateCloseChecklist({ ...clean, ledgerDifferenceCents: 100 });
    expect(checklist.blocked).toBe(true);
    expect(closeChecklistBlocker(checklist, "Motivo suficientemente largo")).toMatch(/No se puede cerrar/);
  });

  it("amortizaciones sin contabilizar: pendiente con enlace a Inmovilizado y exige motivo", () => {
    const checklist = evaluateCloseChecklist({ ...clean, depreciation: { assets: 3, pendingAssets: 2, pendingCents: 123_456, fixedAssetBalanceCents: 900_000 } });
    const item = checklist.items.find((entry) => entry.id === "depreciation");
    expect(item?.status).toBe("pending");
    expect(item?.detail).toContain("1234,56");
    expect(item?.detail).toContain("2 bienes");
    expect(item?.href).toBe("/accounting/assets");
    expect(checklist.requiresOverride).toBe(true);
  });

  it("bienes con todo contabilizado: correcto", () => {
    const checklist = evaluateCloseChecklist({ ...clean, depreciation: { assets: 1, pendingAssets: 0, pendingCents: 0, fixedAssetBalanceCents: 150_000 } });
    const item = checklist.items.find((entry) => entry.id === "depreciation");
    expect(item?.status).toBe("ok");
    expect(item?.detail).toContain("1 bien registrado");
    expect(checklist.requiresOverride).toBe(false);
  });

  it("saldo de inmovilizado sin bienes registrados: recordatorio que no bloquea", () => {
    const checklist = evaluateCloseChecklist({ ...clean, depreciation: { assets: 0, pendingAssets: 0, pendingCents: 0, fixedAssetBalanceCents: 250_000 } });
    const item = checklist.items.find((entry) => entry.id === "depreciation");
    expect(item?.status).toBe("review");
    expect(item?.href).toBe("/accounting/assets/new");
    expect(checklist.requiresOverride).toBe(false);
  });

  describe("Impuesto sobre Sociedades (solo sociedades)", () => {
    const tax = { fiscalYearId: "fy-1", posted: false, upToDate: false, entryCents: 250_000, netQuotaCents: 250_000, manualTaxExpenseCents: 0 };
    const item = (corporateTax: typeof tax | null | undefined) => evaluateCloseChecklist({ ...clean, corporateTax }).items.find((entry) => entry.id === "corporate-tax");

    it("autónomos y otros países: el punto no aparece", () => {
      expect(item(null)).toBeUndefined();
      expect(item(undefined)).toBeUndefined();
    });

    it("sin contabilizar: pendiente, con enlace a la liquidación del ejercicio, y exige motivo", () => {
      const checklist = evaluateCloseChecklist({ ...clean, corporateTax: tax });
      const entry = checklist.items.find((candidate) => candidate.id === "corporate-tax");
      expect(entry).toMatchObject({ status: "pending", title: "Impuesto sobre Sociedades contabilizado", href: "/fiscal/sociedades?year=fy-1" });
      expect(entry?.detail).toContain("2500,00");
      expect(checklist.requiresOverride).toBe(true);
      expect(checklist.blocked).toBe(false);
    });

    it("contabilizado y al día: correcto", () => {
      expect(item({ ...tax, posted: true, upToDate: true })?.status).toBe("ok");
    });

    it("contabilizado pero la liquidación ha cambiado: pendiente de actualizar", () => {
      expect(item({ ...tax, posted: true, upToDate: false })).toMatchObject({ status: "pending", actionLabel: "Actualizar el asiento" });
    });

    it("gasto por impuesto contabilizado a mano: recordatorio que no bloquea", () => {
      expect(item({ ...tax, manualTaxExpenseCents: 240_000 })?.status).toBe("review");
    });

    it("sin cuota ni pagos a cuenta: no hay asiento que hacer", () => {
      expect(item({ ...tax, entryCents: 0, netQuotaCents: 0 })?.status).toBe("ok");
    });
  });

  it("sin 303 (recargo de equivalencia o exenta) no se comprueba el IVA", () => {
    const checklist = evaluateCloseChecklist({ ...clean, lastVatReturn: null });
    expect(checklist.items.some((item) => item.id === "vat-q4-filed")).toBe(false);
  });
});
