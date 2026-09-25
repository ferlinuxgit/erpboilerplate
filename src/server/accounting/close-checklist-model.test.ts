import { describe, expect, it } from "vitest";

import { closeChecklistBlocker, evaluateCloseChecklist, type CloseChecklistFacts } from "@/server/accounting/close-checklist-model";

const clean: CloseChecklistFacts = {
  yearCode: "2026",
  lastVatReturn: { period: "2026-Q4", label: "4.º trimestre de 2026", reportId: "r-1", filed: true },
  draftSalesInvoices: 0,
  account555Cents: 0,
  pendingBankTransactions: 0,
  ledgerDifferenceCents: 0,
};

describe("comprobaciones antes del cierre del ejercicio", () => {
  it("todo correcto: solo queda el recordatorio de amortizaciones y no hace falta motivo", () => {
    const checklist = evaluateCloseChecklist(clean);
    expect(checklist.items.map((item) => [item.id, item.status])).toEqual([
      ["vat-q4-filed", "ok"],
      ["draft-invoices", "ok"],
      ["bank-555", "ok"],
      ["ledger-balanced", "ok"],
      ["depreciation", "review"],
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

  it("sin 303 (recargo de equivalencia o exenta) no se comprueba el IVA", () => {
    const checklist = evaluateCloseChecklist({ ...clean, lastVatReturn: null });
    expect(checklist.items.some((item) => item.id === "vat-q4-filed")).toBe(false);
  });
});
