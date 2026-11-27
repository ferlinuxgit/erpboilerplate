import { describe, expect, it } from "vitest";

import { buildFiledSnapshot, diffFiledSnapshot, FISCAL_SNAPSHOT_VERSION, readFiledSnapshot } from "@/server/fiscal/snapshot";
import type { SpanishFiscalSummary } from "@/server/fiscal/spain";

function summary(overrides: Partial<SpanishFiscalSummary> = {}): SpanishFiscalSummary {
  return {
    code: "303",
    modelName: "Modelo 303",
    periodLabel: "2026 T1",
    dueDate: "2026-04-20T00:00:00.000Z",
    daysUntilDue: 5,
    dueStatus: "due-soon",
    range: { start: "2026-01-01T00:00:00.000Z", endExclusive: "2026-04-01T00:00:00.000Z" },
    salesInvoiceCount: 1,
    supplierInvoiceCount: 0,
    outputTaxBase: 1000,
    outputTaxAmount: 210,
    domesticOutputTaxAmount: 210,
    surchargeAmount: 0,
    selfAssessedTaxAmount: 0,
    inputTaxBase: 0,
    inputTaxAmount: 0,
    deductibleInputTaxAmount: 0,
    nonDeductibleInputTaxAmount: 0,
    settlementAmount: 210,
    amountDue: 210,
    withholdingBase: 0,
    withholdingAmount: 0,
    salesWithholdingAmount: 0,
    buckets: [{ rate: 21, base: 1000, tax: 210 }],
    surchargeBuckets: [],
    inputBuckets: [],
    withholdingBuckets: [],
    warnings: [],
    fiscalProfile: { fiscalRegime: "general", territory: "ES", taxPeriodicity: "quarterly", siiEnabled: false, verifactuMode: "verifactu", prorrataPct: 100, taxpayerType: "company", vatCompensationOpening: {} },
    modelo303Boxes: [
      { box: "07", label: "Base IVA devengado 21%", amount: 1000, kind: "base" },
      { box: "09", label: "Cuota IVA devengado 21%", amount: 210, kind: "tax" },
      { box: "71", label: "Resultado de la liquidación: a ingresar", amount: 210, kind: "settlement" },
    ],
    automationChecks: [{ code: "deadline", status: "warning", title: "Vencimiento fiscal", detail: "", action: "" }],
    sourceDocuments: {
      salesInvoices: [{ id: "inv-1", number: "F-1", issueDate: "2026-02-01T00:00:00.000Z", totalAmount: 1210, taxBase: 1000, taxAmount: 210 }],
      supplierInvoices: [],
    },
    accountingReconciliation: {
      outputVat: { fiscalAmount: 210, accountingAmount: 210, difference: 0 },
      inputVat: { fiscalAmount: 0, accountingAmount: 0, difference: 0 },
      withholdings: { fiscalAmount: 0, accountingAmount: 0, difference: 0 },
      salesWithholdings: { fiscalAmount: 0, accountingAmount: 0, difference: 0 },
      balanced: true,
    },
    ...overrides,
  };
}

describe("Foto de lo presentado", () => {
  it("guarda casillas y totales, sin la lista de documentos ni los avisos previos", () => {
    const snapshot = buildFiledSnapshot(summary(), new Date("2026-04-15T10:00:00.000Z"));
    expect(snapshot.version).toBe(FISCAL_SNAPSHOT_VERSION);
    expect(snapshot.takenAt).toBe("2026-04-15T10:00:00.000Z");
    const stored = readFiledSnapshot(snapshot);
    expect(stored?.amountDue).toBe(210);
    expect(stored?.modelo303Boxes).toHaveLength(3);
    expect(stored?.sourceDocuments).toEqual({ salesInvoices: [], supplierInvoices: [] });
    expect(stored?.automationChecks).toEqual([]);
  });

  it("no reconoce fotos ausentes, de otra versión o mal formadas", () => {
    expect(readFiledSnapshot(null)).toBeNull();
    expect(readFiledSnapshot({ version: 99, takenAt: "", summary: {} })).toBeNull();
    expect(readFiledSnapshot({ version: FISCAL_SNAPSHOT_VERSION, takenAt: "", summary: { code: "303" } })).toBeNull();
  });

  it("sin cambios no hay diferencias, aunque cambien los avisos, el plazo o la etiqueta de una casilla", () => {
    const filed = readFiledSnapshot(buildFiledSnapshot(summary()))!;
    const live = summary({ daysUntilDue: -30, dueStatus: "overdue", automationChecks: [] });
    live.modelo303Boxes[2].label = "Resultado de la liquidación: cero";
    expect(diffFiledSnapshot(filed, live)).toEqual([]);
  });

  it("detecta una factura añadida después: casillas y resultado cambian", () => {
    const filed = readFiledSnapshot(buildFiledSnapshot(summary()))!;
    const live = summary({
      amountDue: 420,
      modelo303Boxes: [
        { box: "07", label: "Base IVA devengado 21%", amount: 2000, kind: "base" },
        { box: "09", label: "Cuota IVA devengado 21%", amount: 420, kind: "tax" },
        { box: "71", label: "Resultado de la liquidación: a ingresar", amount: 420, kind: "settlement" },
        { box: "59", label: "Entregas intracomunitarias de bienes y prestaciones de servicios", amount: 500, kind: "info" },
      ],
    });
    expect(diffFiledSnapshot(filed, live)).toEqual([
      { label: "Resultado del modelo", filed: 210, current: 420 },
      { label: "Casilla 07 · Base IVA devengado 21%", filed: 1000, current: 2000 },
      { label: "Casilla 09 · Cuota IVA devengado 21%", filed: 210, current: 420 },
      { label: "Casilla 71 · Resultado de la liquidación: a ingresar", filed: 210, current: 420 },
      { label: "Casilla 59 · Entregas intracomunitarias de bienes y prestaciones de servicios", filed: null, current: 500 },
    ]);
  });

  it("compara los terceros del 347, con su desglose trimestral", () => {
    const base = { code: "347" as const, amountDue: null, modelo303Boxes: [] };
    const filed = readFiledSnapshot(buildFiledSnapshot(summary({ ...base, thirdPartyOperations: [{ type: "customer", taxId: "B12345674", name: "Pérez S.L.", amount: 4000, quarters: [4000, 0, 0, 0] }] })))!;
    const live = summary({ ...base, thirdPartyOperations: [{ type: "customer", taxId: "B12345674", name: "Pérez S.L.", amount: 5000, quarters: [4000, 1000, 0, 0] }] });
    expect(diffFiledSnapshot(filed, live)).toEqual([
      { label: "Cliente Pérez S.L. (B12345674)", filed: 4000, current: 5000 },
      { label: "Cliente Pérez S.L. (B12345674) · 2T", filed: null, current: 1000 },
    ]);
    // Un tercero que deja de superar el umbral también es una diferencia.
    expect(diffFiledSnapshot(filed, summary({ ...base, thirdPartyOperations: [] }))).toEqual([
      { label: "Cliente Pérez S.L. (B12345674)", filed: 4000, current: null },
      { label: "Cliente Pérez S.L. (B12345674) · 1T", filed: 4000, current: null },
    ]);
  });
});

describe("foto de lo presentado: campos añadidos después", () => {
  it("una foto del 390 sin numeración oficial no se compara con el resumen numerado", () => {
    const legacy = summary({ code: "390", amountDue: null, annualSummaryBoxes: [{ box: "", label: "Total cuotas devengadas del ejercicio", amount: 2100, kind: "tax" }] });
    const current = summary({ code: "390", amountDue: null, annualSummaryBoxes: [{ box: "47", label: "Total cuotas IVA y recargo de equivalencia", amount: 2100, kind: "tax" }] });
    expect(diffFiledSnapshot(legacy, current)).toEqual([]);
    // Con numeración en las dos, un cambio sí se detecta.
    const changed = summary({ code: "390", amountDue: null, annualSummaryBoxes: [{ box: "47", label: "Total cuotas IVA y recargo de equivalencia", amount: 2500, kind: "tax" }] });
    expect(diffFiledSnapshot(current, changed)).toEqual([{ label: "Casilla 47 · Total cuotas IVA y recargo de equivalencia", filed: 2100, current: 2500 }]);
  });

  it("347: una foto antigua sin marcas se compara igual, y los registros con marca se distinguen", () => {
    const party = { type: "supplier" as const, taxId: "B12345678", name: "Proveedor", quarters: [0, 0, 0, 0] as [number, number, number, number] };
    const filed = summary({ code: "347", amountDue: null, thirdPartyOperations: [{ ...party, amount: 5000 }] });
    expect(diffFiledSnapshot(filed, summary({ code: "347", amountDue: null, thirdPartyOperations: [{ ...party, amount: 5000 }] }))).toEqual([]);
    const split = summary({ code: "347", amountDue: null, thirdPartyOperations: [
      { ...party, amount: 4000 },
      { ...party, amount: 1000, flags: { cashAccounting: true }, cashAccrualAmount: 600 },
    ] });
    expect(diffFiledSnapshot(filed, split).map((difference) => [difference.label, difference.filed, difference.current])).toEqual([
      ["Proveedor Proveedor (B12345678)", 5000, 4000],
      ["Proveedor Proveedor (B12345678) · criterio de caja", null, 1000],
      ["Proveedor Proveedor (B12345678) · criterio de caja · devengado según el criterio de caja", null, 600],
    ]);
  });

  it("los campos nuevos del resumen (criterio de caja, prorrata) viajan en la foto y una foto sin ellos se lee", () => {
    const withNew = summary({
      cashAccounting: { ownRegime: true, salesBase: 1000, salesTax: 210, purchaseBase: 0, purchaseTax: 0, deadlineSalesInvoices: 0, deadlinePurchaseInvoices: 0 },
      prorrata: { year: 2026, provisionalPct: 90, computedPct: 80, totalOperations: 10000, deductibleOperations: 8000, exemptOperations: 2000, confirmedPct: 80, regularizationAmount: -42, previewRegularizationAmount: null, investmentRegularizationAmount: 0, investmentGoods: [] },
    });
    const stored = readFiledSnapshot(buildFiledSnapshot(withNew));
    expect(stored?.cashAccounting?.ownRegime).toBe(true);
    expect(stored?.prorrata?.confirmedPct).toBe(80);
    const old = readFiledSnapshot(buildFiledSnapshot(summary()));
    expect(old?.cashAccounting).toBeUndefined();
    expect(diffFiledSnapshot(old!, withNew)).toEqual([]);
  });
});
