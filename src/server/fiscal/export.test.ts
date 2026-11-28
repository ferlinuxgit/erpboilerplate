import { describe, expect, it } from "vitest";

import { fiscalSummaryDetailRows, fiscalSummaryToCsv } from "@/server/fiscal/export";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

/** Resumen mínimo: solo los campos que lee la exportación. */
function summaryOf(overrides: Partial<SpanishFiscalSummary>): SpanishFiscalSummary {
  return {
    code: "303",
    modelName: "Modelo 303",
    periodLabel: "4T 2026",
    amountDue: 0,
    modelo303Boxes: [],
    buckets: [],
    inputBuckets: [],
    withholdingBuckets: [],
    sourceDocuments: { salesInvoices: [], supplierInvoices: [] },
    ...overrides,
  } as unknown as SpanishFiscalSummary;
}

describe("exportación de un modelo fiscal", () => {
  it("lleva la liquidación del 303 (110, 78, 87), el criterio de caja y la prorrata", () => {
    const csv = fiscalSummaryToCsv(summaryOf({
      modelo303Boxes: [{ box: "71", label: "Resultado", amount: -50, kind: "settlement" }],
      vatSettlement: { openingAmount: 100, pendingBefore: 100, applied: 0, pendingAfter: 100, result: -50, carryForward: 150, lastPeriod: true },
      cashAccounting: { ownRegime: true, salesBase: 1000, salesTax: 210, purchaseBase: 0, purchaseTax: 0, deadlineSalesInvoices: 0, deadlinePurchaseInvoices: 0 },
      prorrata: { year: 2026, provisionalPct: 80, computedPct: 75, totalOperations: 1000, deductibleOperations: 750, exemptOperations: 250, confirmedPct: 75, regularizationAmount: -12.5, previewRegularizationAmount: null, investmentRegularizationAmount: null, investmentGoods: [] } as unknown as SpanishFiscalSummary["prorrata"],
    }));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toMatch(/Liquidación 303;110;[^;]+;;100,00/);
    expect(csv).toMatch(/Liquidación 303;87;[^;]+;;100,00/);
    expect(csv).toMatch(/Criterio de caja;62;[^;]+;;1000,00/);
    expect(csv).toMatch(/Prorrata;44;[^;]+;;-12,50/);
  });

  it("lleva las casillas numeradas del 390", () => {
    const rows = fiscalSummaryDetailRows(summaryOf({ code: "390", annualSummaryBoxes: [{ box: "84", label: "Suma de resultados", amount: 500, kind: "settlement" }] }));
    expect(rows).toContainEqual({ section: "Casillas 390", box: "84", label: "Suma de resultados", taxId: null, amount: 500 });
  });

  it("lleva las marcas, los trimestres y lo devengado por caja del 347", () => {
    const csv = fiscalSummaryToCsv(summaryOf({
      code: "347",
      thirdPartyOperations: [{ type: "supplier", taxId: "B12345674", name: "Locales SL", amount: 6000, quarters: [1500, 1500, 1500, 1500], flags: { lease: true, cashAccounting: true }, cashAccrualAmount: 4500 }],
    }));
    expect(csv).toMatch(/Operaciones 347;Proveedor;Locales SL \[arrendamiento de local, criterio de caja\];B12345674;6000,00/);
    expect(csv).toMatch(/Operaciones 347 por trimestre;Proveedor · 4T;/);
    expect(csv).toMatch(/Operaciones 347 devengadas por criterio de caja;Proveedor;[^;]+;B12345674;4500,00/);
  });

  it("lleva las bases declarada y rectificada del 349", () => {
    const csv = fiscalSummaryToCsv(summaryOf({
      code: "349",
      modelo349: { operators: [], rectifications: [{ key: "E", taxId: "FR123", name: "Client FR", countryCode: "FR", amount: -100, originalPeriod: "2026-Q1", previousAmount: 1000, rectifiedAmount: 900 }], operatorCount: 1, totalAmount: 0 } as unknown as SpanishFiscalSummary["modelo349"],
    }));
    expect(csv).toMatch(/Rectificaciones 349 · base declarada anteriormente;E;[^;]+;FR123;1000,00/);
    expect(csv).toMatch(/Rectificaciones 349 · base imponible rectificada;E;[^;]+;FR123;900,00/);
  });

  it("lleva las casillas de retenciones con los perceptores como número, no como importe", () => {
    const csv = fiscalSummaryToCsv(summaryOf({
      code: "111",
      withholdingModel: { code: "111", boxes: [{ box: "01", label: "Perceptores", amount: 3, kind: "count" }, { box: "03", label: "Retenciones", amount: 450, kind: "tax" }] } as unknown as SpanishFiscalSummary["withholdingModel"],
    }));
    expect(csv).toMatch(/Casillas 111;01;Perceptores;;3\r\n/);
    expect(csv).toMatch(/Casillas 111;03;Retenciones;;450,00/);
  });

  it("protege frente a fórmulas", () => {
    expect(fiscalSummaryToCsv(summaryOf({ modelo303Boxes: [{ box: "01", label: "=SUMA(A1)", amount: 1, kind: "base" }] }))).toMatch(/'=SUMA\(A1\)/);
  });
});
