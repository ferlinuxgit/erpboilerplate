import { describe, expect, it } from "vitest";

import {
  findExactSubset,
  matchRule,
  nameSimilarity,
  proposeRuleConcept,
  rankSuggestions,
  referenceStrength,
  resolutionOf,
  validateAllocations,
  type ExistingPaymentCandidate,
  type OpenInvoiceCandidate,
  type RuleCandidate,
} from "@/server/treasury/matching";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function invoice(overrides: Partial<OpenInvoiceCandidate> & { id: string }): OpenInvoiceCandidate {
  return {
    kind: "customer",
    number: `F-${overrides.id}`,
    altNumber: null,
    partnerId: "p-1",
    partnerName: "Cliente Ejemplo SA",
    outstanding: 100,
    dueDate: null,
    issueDate: day("2026-08-01"),
    ...overrides,
  };
}

function payment(overrides: Partial<ExistingPaymentCandidate> & { id: string }): ExistingPaymentCandidate {
  return {
    kind: "customer",
    number: "REC-0001",
    invoiceNumber: "F-2026-0042",
    partnerName: "Cliente Ejemplo SA",
    amount: 1210,
    postedAt: day("2026-09-03"),
    ...overrides,
  };
}

const rule: RuleCandidate = {
  id: "rule-1",
  name: "Comisiones",
  conceptContains: "comision",
  direction: "OUT",
  minAmount: null,
  maxAmount: 50,
  accountId: "acc-626",
  accountLabel: "626 · Servicios bancarios",
  partnerId: null,
  partnerName: null,
  autoApply: false,
};

const empty = { payments: [], invoices: [], rules: [] };

describe("suggestion ranking", () => {
  it("proposes the invoice cited in the concept as a safe match", () => {
    const movement = { id: "bt-1", amount: 1210, description: "TRANSF DE CLIENTE EJEMPLO SA PAGO FRA F-2026-0042", postedAt: day("2026-09-03") };
    const suggestions = rankSuggestions(movement, {
      ...empty,
      invoices: [invoice({ id: "a", number: "F-2026-0042", outstanding: 1210 }), invoice({ id: "b", number: "F-2026-0050", outstanding: 1210 })],
    });
    expect(suggestions[0]).toMatchObject({ kind: "INVOICE", safe: true, confidence: "alta" });
    expect(suggestions[0].allocations).toEqual([{ type: "CUSTOMER_INVOICE", targetId: "a", amount: 1210, label: "F-2026-0042" }]);
    expect(suggestions[1].safe).toBe(false);
  });

  it("does not mark as safe two invoices of the same amount without a reference", () => {
    const movement = { id: "bt-1", amount: 100, description: "TRANSFERENCIA RECIBIDA", postedAt: day("2026-09-03") };
    const suggestions = rankSuggestions(movement, { ...empty, invoices: [invoice({ id: "a" }), invoice({ id: "b" })] });
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((suggestion) => !suggestion.safe)).toBe(true);
  });

  it("prefers an existing payment of the same amount within ±3 days and ignores older ones", () => {
    const movement = { id: "bt-1", amount: 1210, description: "TRANSFERENCIA", postedAt: day("2026-09-03") };
    const suggestions = rankSuggestions(movement, {
      ...empty,
      payments: [payment({ id: "ip-1", postedAt: day("2026-09-02") }), payment({ id: "ip-old", postedAt: day("2026-08-20") })],
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ kind: "EXISTING_PAYMENT", safe: true });
    expect(suggestions[0].allocations[0]).toMatchObject({ type: "CUSTOMER_PAYMENT", targetId: "ip-1" });
  });

  it("never proposes customer documents for a charge", () => {
    const movement = { id: "bt-1", amount: -100, description: "PAGO", postedAt: day("2026-09-03") };
    expect(rankSuggestions(movement, { ...empty, invoices: [invoice({ id: "a" })], payments: [payment({ id: "ip", amount: 100 })] })).toEqual([]);
  });

  it("applies account rules (direction and amount range) as suggestions", () => {
    const fee = { id: "bt-1", amount: -12.5, description: "COMISIÓN MANTENIMIENTO", postedAt: day("2026-09-02") };
    const [suggestion] = rankSuggestions(fee, { ...empty, rules: [rule] });
    expect(suggestion).toMatchObject({ kind: "RULE", ruleId: "rule-1", safe: true });
    expect(suggestion.allocations).toEqual([{ type: "ACCOUNT", targetId: "acc-626", amount: 12.5, label: "626 · Servicios bancarios" }]);
    expect(rankSuggestions({ ...fee, amount: -80 }, { ...empty, rules: [rule] })).toEqual([]);
    expect(rankSuggestions({ ...fee, amount: 12.5 }, { ...empty, rules: [rule] })).toEqual([]);
  });

  it("splits one movement across several invoices cited in the concept", () => {
    const movement = { id: "bt-1", amount: 350, description: "PAGO FRAS F-2026-0010 Y F-2026-0011", postedAt: day("2026-09-03") };
    const suggestions = rankSuggestions(movement, {
      ...empty,
      invoices: [invoice({ id: "a", number: "F-2026-0010", outstanding: 200 }), invoice({ id: "b", number: "F-2026-0011", outstanding: 150 }), invoice({ id: "c", number: "F-2026-0012", outstanding: 350 })],
    });
    expect(suggestions[0]).toMatchObject({ kind: "SPLIT", safe: true });
    expect(suggestions[0].allocations.map((allocation) => [allocation.targetId, allocation.amount])).toEqual([["a", 200], ["b", 150]]);
  });

  it("finds a combination of invoices of the customer named in the concept, or pays the oldest first", () => {
    const invoices = [
      invoice({ id: "a", outstanding: 100, dueDate: day("2026-07-01") }),
      invoice({ id: "b", outstanding: 250, dueDate: day("2026-08-01") }),
      invoice({ id: "c", outstanding: 50, dueDate: day("2026-09-01") }),
    ];
    const exact = rankSuggestions({ id: "bt", amount: 150, description: "TRANSF EJEMPLO", postedAt: day("2026-09-03") }, { ...empty, invoices });
    const split = exact.find((suggestion) => suggestion.kind === "SPLIT");
    expect(split?.allocations.map((allocation) => allocation.targetId)).toEqual(["a", "c"]);
    const fifo = rankSuggestions({ id: "bt", amount: 170, description: "TRANSF CLIENTE EJEMPLO", postedAt: day("2026-09-03") }, { ...empty, invoices });
    const partial = fifo.find((suggestion) => suggestion.key.startsWith("fifo:"));
    expect(partial?.allocations.map((allocation) => [allocation.targetId, allocation.amount])).toEqual([["a", 100], ["b", 70]]);
    expect(partial?.safe).toBe(false);
  });

  it("proposes a whole confirmed SEPA remittance for its single bank charge", () => {
    const payments = [
      payment({ id: "sp-1", kind: "supplier", amount: 300, remittanceId: "rem-1", remittanceNumber: "REM2026", postedAt: day("2026-09-10") }),
      payment({ id: "sp-2", kind: "supplier", amount: 200, remittanceId: "rem-1", remittanceNumber: "REM2026", postedAt: day("2026-09-10") }),
    ];
    const [suggestion] = rankSuggestions({ id: "bt", amount: -500, description: "ORDEN DE PAGO REMESA", postedAt: day("2026-09-11") }, { ...empty, payments });
    expect(suggestion).toMatchObject({ kind: "REMITTANCE", safe: true });
    expect(suggestion.allocations.map((allocation) => allocation.type)).toEqual(["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT"]);
  });

  it("helpers: references, names, subsets, rule concept", () => {
    expect(referenceStrength("F-2026/0042", "pago f 2026 0042")).toBe(2);
    expect(referenceStrength("FAC-000123", "PAGO FACTURA 123")).toBe(0);
    expect(referenceStrength("FAC-2026-4521", "PAGO FACTURA 4521")).toBe(1);
    expect(nameSimilarity("Transportes García, S.L.", "TRANSF TRANSPORTES GARCIA")).toBe(1);
    expect(findExactSubset([invoice({ id: "a", outstanding: 10 }), invoice({ id: "b", outstanding: 20 })], 1000)).toBeNull();
    expect(proposeRuleConcept("RECIBO TGSS REGIMEN AUTONOMOS 202609 0012345")).toBe("recibo tgss regimen");
    expect(matchRule({ conceptContains: "TGSS", direction: "ANY", minAmount: null, maxAmount: null }, { amount: -294, description: "Recibo tgss autónomos" })).toBe(true);
  });
});

describe("split validation", () => {
  it("accepts an exact split, partial payments and a fee netted against a receipt", () => {
    expect(validateAllocations(350, [
      { type: "CUSTOMER_INVOICE", targetId: "a", amount: 200 },
      { type: "CUSTOMER_INVOICE", targetId: "b", amount: 150 },
    ])).toEqual([]);
    // Cobro de 1.000 con 5 € de comisión descontada por el banco: entra 995.
    expect(validateAllocations(995, [
      { type: "CUSTOMER_INVOICE", targetId: "a", amount: 1000 },
      { type: "ACCOUNT", targetId: "acc-626", amount: -5 },
    ])).toEqual([]);
  });

  it("rejects sums that do not match, wrong sides, duplicates and zero amounts", () => {
    expect(validateAllocations(100, [{ type: "CUSTOMER_INVOICE", targetId: "a", amount: 90 }])[0]).toMatch(/faltan 10\.00/);
    expect(validateAllocations(100, [{ type: "CUSTOMER_INVOICE", targetId: "a", amount: 110 }])[0]).toMatch(/sobran 10\.00/);
    expect(validateAllocations(-100, [{ type: "CUSTOMER_INVOICE", targetId: "a", amount: 100 }])[0]).toMatch(/Un cargo solo/);
    expect(validateAllocations(100, [
      { type: "CUSTOMER_INVOICE", targetId: "a", amount: 50 },
      { type: "CUSTOMER_INVOICE", targetId: "a", amount: 50 },
    ])).toContain("La misma factura o cobro/pago aparece dos veces en el reparto.");
    expect(validateAllocations(100, [{ type: "ACCOUNT", targetId: "x", amount: 0 }, { type: "ACCOUNT", targetId: "y", amount: 100 }])).toContain("Cada partida debe tener un importe distinto de cero.");
    expect(validateAllocations(100, [])).toContain("Indica al menos una factura, cobro/pago o cuenta.");
    // Céntimos exactos: 0,1 + 0,2 cuadra con 0,3.
    expect(validateAllocations(0.3, [{ type: "ACCOUNT", targetId: "x", amount: 0.1 }, { type: "ACCOUNT", targetId: "y", amount: 0.2 }])).toEqual([]);
  });

  it("classifies the resolution", () => {
    expect(resolutionOf([{ type: "ACCOUNT" }])).toBe("ACCOUNT");
    expect(resolutionOf([{ type: "CUSTOMER_INVOICE" }])).toBe("PAYMENT");
    expect(resolutionOf([{ type: "CUSTOMER_INVOICE" }, { type: "ACCOUNT" }])).toBe("MIXED");
  });
});
