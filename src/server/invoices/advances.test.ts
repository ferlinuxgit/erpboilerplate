import { describe, expect, it } from "vitest";

import { applyGlobalDiscount, calculateInvoiceTotals, type InvoiceCalculationLine } from "@/lib/invoice-totals";
import {
  advanceDeductionProblem,
  advanceDeductionsOf,
  advanceTaxKey,
  basesByAdvanceTaxKey,
  buildPostingSalesLines,
  negativeBaseProblem,
  onlyDisbursementsProblem,
  type AdvanceInvoiceState,
} from "@/server/invoices/advances";

const vat21 = { id: "vat21", name: "IVA 21%", rate: 21, kind: "VAT", operation: "ADD" as const };
const vat10 = { id: "vat10", name: "IVA 10%", rate: 10, kind: "VAT", operation: "ADD" as const };
const irpf15 = { id: "irpf15", name: "IRPF 15%", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" as const };

function advanceState(overrides: Partial<AdvanceInvoiceState> = {}): AdvanceInvoiceState {
  return {
    id: "adv1",
    number: "F-2026-0001",
    customerId: "c1",
    isAdvance: true,
    invoiceType: "INVOICE",
    issued: true,
    baseByTaxKey: new Map([[advanceTaxKey({ taxes: [vat21] }), 30000]]),
    deductedByTaxKey: new Map(),
    ...overrides,
  };
}

function finalInvoice(advanceAmount: number, taxes = [vat21]): InvoiceCalculationLine[] {
  return [
    { description: "Obra completa", quantity: 1, unitPrice: 1000, taxes: [vat21] },
    { description: "Anticipo según factura F-2026-0001", quantity: 1, unitPrice: -advanceAmount, taxes, advanceInvoiceId: "adv1" },
  ];
}

describe("anticipos (art. 75.Dos LIVA)", () => {
  it("la clave de tipos ignora la retención y distingue el recargo", () => {
    expect(advanceTaxKey({ taxes: [vat21, irpf15] })).toBe(advanceTaxKey({ taxes: [vat21] }));
    expect(advanceTaxKey({ taxes: [vat21] })).not.toBe(advanceTaxKey({ taxes: [vat10] }));
    expect(advanceTaxKey({ taxRate: 21, retentionRate: 0 })).toBe(advanceTaxKey({ taxes: [vat21] }));
    expect(advanceTaxKey({ taxes: [] })).toBe("SIN_IMPUESTO");
  });

  it("la factura final descuenta base y cuota del anticipo", () => {
    const lines = finalInvoice(300);
    const totals = calculateInvoiceTotals(lines);
    expect(totals.subtotal).toBe(700);
    expect(totals.taxAmount).toBe(147);
    expect(advanceDeductionsOf(lines, totals)).toEqual([{ advanceInvoiceId: "adv1", taxKey: advanceTaxKey({ taxes: [vat21] }), cents: 30000 }]);
    expect(basesByAdvanceTaxKey(lines, totals, (line) => Boolean(line.advanceInvoiceId)).get(advanceTaxKey({ taxes: [vat21] }))).toBe(-30000);
  });

  it("acepta el anticipo del mismo cliente, al mismo tipo y sin pasarse", () => {
    const lines = finalInvoice(300);
    const deductions = advanceDeductionsOf(lines, calculateInvoiceTotals(lines));
    expect(advanceDeductionProblem({ customerId: "c1", invoiceIsAdvance: false, deductions, advances: new Map([["adv1", advanceState()]]) })).toBeNull();
  });

  it("rechaza otro cliente, otro tipo, un importe mayor, lo ya descontado y anticipos sin emitir", () => {
    const check = (lines: InvoiceCalculationLine[], state: Partial<AdvanceInvoiceState> = {}, customerId = "c1", invoiceIsAdvance = false) =>
      advanceDeductionProblem({ customerId, invoiceIsAdvance, deductions: advanceDeductionsOf(lines, calculateInvoiceTotals(lines)), advances: new Map([["adv1", advanceState(state)]]) });
    expect(check(finalInvoice(300), {}, "c2")).toMatch(/otro cliente/);
    expect(check(finalInvoice(300, [vat10]))).toMatch(/mismos impuestos/);
    expect(check(finalInvoice(300.01))).toMatch(/quedan por descontar 300,00 €/);
    expect(check(finalInvoice(200), { deductedByTaxKey: new Map([[advanceTaxKey({ taxes: [vat21] }), 15000]]) })).toMatch(/quedan por descontar 150,00 €/);
    expect(check(finalInvoice(300), { issued: false })).toMatch(/todavía no está emitida/);
    expect(check(finalInvoice(300), { isAdvance: false })).toMatch(/no es una factura de anticipo/);
    expect(check(finalInvoice(300), {}, "c1", true)).toMatch(/no puede descontar otro anticipo/);
    expect(advanceDeductionProblem({ customerId: "c1", invoiceIsAdvance: false, deductions: advanceDeductionsOf(finalInvoice(300), calculateInvoiceTotals(finalInvoice(300))), advances: new Map() })).toMatch(/no existe/);
  });

  it("ninguna base puede quedar negativa", () => {
    const lines: InvoiceCalculationLine[] = [
      { description: "Venta", quantity: 1, unitPrice: 100, taxes: [vat21] },
      { description: "Anticipo", quantity: 1, unitPrice: -150, taxes: [vat21], advanceInvoiceId: "adv1" },
    ];
    expect(negativeBaseProblem(calculateInvoiceTotals(lines))).toMatch(/al 21 % queda en negativo/);
    expect(negativeBaseProblem(calculateInvoiceTotals(finalInvoice(300)))).toBeNull();
  });
});

describe("suplidos: no hay factura solo de suplidos", () => {
  it("exige una operación además del suplido", () => {
    const only: InvoiceCalculationLine[] = [{ description: "Tasa pagada por cuenta del cliente", quantity: 1, unitPrice: 50, taxes: [], isDisbursement: true }];
    expect(onlyDisbursementsProblem(only, calculateInvoiceTotals(only))).toMatch(/solo suplidos/);
    const withService: InvoiceCalculationLine[] = [...only, { description: "Gestión", quantity: 1, unitPrice: 100, taxes: [vat21] }];
    expect(onlyDisbursementsProblem(withService, calculateInvoiceTotals(withService))).toBeNull();
    const noDisbursement: InvoiceCalculationLine[] = [{ description: "Gestión", quantity: 1, unitPrice: 100, taxes: [vat21] }];
    expect(onlyDisbursementsProblem(noDisbursement, calculateInvoiceTotals(noDisbursement))).toBeNull();
  });
});

describe("bases para el asiento", () => {
  it("una factura corriente da lo mismo que antes: una entrada de ventas por línea", () => {
    const lines = [
      { description: "A", quantity: 2, unitPrice: 50, taxes: [vat21], itemId: "i1" },
      { description: "B", quantity: 1, unitPrice: 30, taxes: [vat10], itemId: null },
    ];
    const totals = calculateInvoiceTotals(lines);
    expect(buildPostingSalesLines(lines, totals)).toEqual([
      { itemId: "i1", subtotal: 100, role: "sales" },
      { itemId: null, subtotal: 30, role: "sales" },
    ]);
  });

  it("la factura de anticipo lleva su base a la 438", () => {
    const lines = [{ description: "Anticipo del 30 %", quantity: 1, unitPrice: 300, taxes: [vat21] }];
    expect(buildPostingSalesLines(lines, calculateInvoiceTotals(lines), { advanceInvoice: true })).toEqual([{ itemId: null, subtotal: 300, role: "advance" }]);
  });

  it("la final carga la 438 por el anticipo y deja la venta entera", () => {
    const lines = finalInvoice(300);
    const posting = buildPostingSalesLines(lines, calculateInvoiceTotals(lines));
    expect(posting).toEqual([
      { itemId: null, subtotal: 1000, role: "sales" },
      { itemId: null, subtotal: -300, role: "advance" },
    ]);
  });

  it("el descuento global minora las ventas de su tipo en proporción y los suplidos no aparecen", () => {
    const own = [
      { description: "A", quantity: 1, unitPrice: 300, taxes: [vat21], itemId: "i1" },
      { description: "B", quantity: 1, unitPrice: 100, taxes: [vat21], itemId: "i2" },
      { description: "C", quantity: 1, unitPrice: 100, taxes: [vat10], itemId: "i3" },
      { description: "Tasa", quantity: 1, unitPrice: 20, taxes: [], isDisbursement: true },
    ];
    const lines = applyGlobalDiscount(own, { pct: 10 });
    const totals = calculateInvoiceTotals(lines);
    const posting = buildPostingSalesLines(lines, totals);
    expect(posting).toEqual([
      { itemId: "i1", subtotal: 270, role: "sales" },
      { itemId: "i2", subtotal: 90, role: "sales" },
      { itemId: "i3", subtotal: 90, role: "sales" },
    ]);
    expect(posting.reduce((sum, entry) => sum + entry.subtotal, 0)).toBe(totals.subtotal);
  });
});
