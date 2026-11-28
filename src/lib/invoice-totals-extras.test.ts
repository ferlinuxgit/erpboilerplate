import { describe, expect, it } from "vitest";

import {
  applyGlobalDiscount,
  apportionCents,
  buildGlobalDiscountLines,
  calculateInvoiceTotals,
  summarizeInvoiceAmounts,
  type InvoiceCalculationLine,
} from "@/lib/invoice-totals";
import { computeEngineDocument, computeEngineLine } from "@/server/taxation/engine";

const vat21 = { id: "vat21", name: "IVA 21%", rate: 21, kind: "VAT", operation: "ADD" as const };
const vat10 = { id: "vat10", name: "IVA 10%", rate: 10, kind: "VAT", operation: "ADD" as const };
const irpf15 = { id: "irpf15", name: "IRPF 15%", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" as const };

describe("suplidos (art. 78.Tres.3.º LIVA)", () => {
  it("el motor no los trata como base: ni impuestos, ni retención, ni descuento", () => {
    const line = computeEngineLine({ quantity: 1, unitPrice: 60.5, discountPct: 50, taxes: [vat21, irpf15], disbursement: true });
    expect(line).toEqual({ baseCents: 0, taxCents: 0, retentionCents: 0, totalCents: 6050, taxes: [], disbursementCents: 6050 });
  });

  it("se suman al total a pagar y no al desglose por tipo", () => {
    const result = computeEngineDocument([
      { quantity: 1, unitPrice: 1000, taxes: [vat21, irpf15] },
      { quantity: 2, unitPrice: 30.25, taxes: [vat21], disbursement: true },
    ]);
    expect(result.subtotalCents).toBe(100000);
    expect(result.taxCents).toBe(21000);
    expect(result.retentionCents).toBe(15000);
    expect(result.disbursementCents).toBe(6050);
    expect(result.totalCents).toBe(100000 + 21000 - 15000 + 6050);
    expect(result.buckets.map((bucket) => [bucket.key, bucket.baseCents])).toEqual([["ADD|VAT|21", 100000], ["SUBTRACT|WITHHOLDING|15", 100000]]);
  });

  it("la factura con suplido coincide con la misma factura sin él salvo en el total a pagar", () => {
    const base: InvoiceCalculationLine[] = [
      { description: "Honorarios", quantity: 1, unitPrice: 1000, taxes: [vat21, irpf15] },
      { description: "Material", quantity: 3, unitPrice: 19.99, discountPct: 10, taxes: [vat10] },
    ];
    const without = calculateInvoiceTotals(base);
    const withDisbursement = calculateInvoiceTotals([...base, { description: "Tasa del Registro Mercantil", quantity: 1, unitPrice: 43.27, taxes: [vat21], isDisbursement: true }]);
    expect(withDisbursement.subtotal).toBe(without.subtotal);
    expect(withDisbursement.taxAmount).toBe(without.taxAmount);
    expect(withDisbursement.retentionAmount).toBe(without.retentionAmount);
    expect(withDisbursement.taxBuckets).toEqual(without.taxBuckets);
    expect(withDisbursement.disbursementAmount).toBe(43.27);
    expect(withDisbursement.totalAmount).toBe(Math.round((without.totalAmount + 43.27) * 100) / 100);
    expect(withDisbursement.lines[2]).toEqual({ subtotal: 0, taxAmount: 0, retentionAmount: 0, lineTotal: 43.27, taxes: [], disbursementAmount: 43.27 });
  });

  it("en una rectificativa el suplido se abona en negativo", () => {
    const totals = calculateInvoiceTotals([
      { description: "Honorarios", quantity: -1, unitPrice: 100, taxes: [vat21] },
      { description: "Tasa", quantity: -1, unitPrice: 20, isDisbursement: true },
    ], { allowNegative: true });
    expect(totals.subtotal).toBe(-100);
    expect(totals.disbursementAmount).toBe(-20);
    expect(totals.totalAmount).toBe(-141);
  });

  it("un suplido negativo en una factura ordinaria no resta", () => {
    const totals = calculateInvoiceTotals([
      { description: "Honorarios", quantity: 1, unitPrice: 100, taxes: [vat21] },
      { description: "Tasa", quantity: 1, unitPrice: -20, isDisbursement: true },
    ]);
    expect(totals.disbursementAmount).toBe(0);
    expect(totals.totalAmount).toBe(121);
  });
});

describe("descuento global (art. 78.Tres.2.º LIVA)", () => {
  const lines: InvoiceCalculationLine[] = [
    { description: "Servicio", quantity: 1, unitPrice: 1000, taxes: [vat21] },
    { description: "Libro", quantity: 2, unitPrice: 50, taxes: [vat10] },
    { description: "Tasa", quantity: 1, unitPrice: 30, isDisbursement: true },
  ];

  it("sin descuento no genera líneas", () => {
    expect(buildGlobalDiscountLines(lines, null)).toEqual([]);
    expect(buildGlobalDiscountLines(lines, { pct: 0, amount: 0 })).toEqual([]);
    expect(applyGlobalDiscount(lines, {})).toEqual(lines);
  });

  it("el porcentaje minora cada base por tipo y los suplidos quedan fuera", () => {
    const discounted = applyGlobalDiscount(lines, { pct: 5 });
    expect(discounted.slice(3)).toEqual([
      { description: "Descuento 5 %", quantity: 1, unitPrice: -50, discountPct: 0, taxes: [vat21], isGlobalDiscount: true },
      { description: "Descuento 5 %", quantity: 1, unitPrice: -5, discountPct: 0, taxes: [vat10], isGlobalDiscount: true },
    ]);
    const totals = calculateInvoiceTotals(discounted);
    expect(totals.taxBuckets.map((bucket) => [bucket.rate, bucket.baseAmount, bucket.amount])).toEqual([[21, 950, 199.5], [10, 95, 9.5]]);
    expect(totals.subtotal).toBe(1045);
    expect(totals.taxAmount).toBe(209);
    expect(totals.disbursementAmount).toBe(30);
    expect(totals.totalAmount).toBe(1284);
    expect(summarizeInvoiceAmounts(discounted, totals)).toEqual({
      grossSubtotal: 1100,
      globalDiscountAmount: 55,
      advanceDeductedAmount: 0,
      subtotal: 1045,
      invoiceTotal: 1254,
      disbursementAmount: 30,
      retentionAmount: 0,
      totalAmount: 1284,
    });
  });

  it("el importe fijo se reparte en proporción y suma exactamente lo pedido", () => {
    const three: InvoiceCalculationLine[] = [
      { description: "A", quantity: 1, unitPrice: 100, taxes: [vat21] },
      { description: "B", quantity: 1, unitPrice: 100, taxes: [vat10] },
      { description: "C", quantity: 1, unitPrice: 100, taxes: [] },
    ];
    const generated = buildGlobalDiscountLines(three, { amount: 100 });
    expect(generated.map((line) => line.unitPrice)).toEqual([-33.34, -33.33, -33.33]);
    expect(calculateInvoiceTotals(applyGlobalDiscount(three, { amount: 100 })).subtotal).toBe(200);
  });

  it("el importe fijo nunca supera la base", () => {
    const totals = calculateInvoiceTotals(applyGlobalDiscount([{ description: "A", quantity: 1, unitPrice: 80, taxes: [vat21] }], { amount: 500 }));
    expect(totals.subtotal).toBe(0);
    expect(totals.taxAmount).toBe(0);
  });

  it("la retención también se calcula sobre la base ya descontada", () => {
    const totals = calculateInvoiceTotals(applyGlobalDiscount([{ description: "Honorarios", quantity: 1, unitPrice: 1000, taxes: [vat21, irpf15] }], { pct: 10 }));
    expect(totals.subtotal).toBe(900);
    expect(totals.taxAmount).toBe(189);
    expect(totals.retentionAmount).toBe(135);
    expect(totals.totalAmount).toBe(954);
  });

  it("funciona con líneas antiguas (tipo de IVA en la línea)", () => {
    const generated = buildGlobalDiscountLines([{ description: "A", quantity: 1, unitPrice: 200, taxRate: 21, retentionRate: 15 }], { pct: 10 });
    expect(generated).toEqual([{ description: "Descuento 10 %", quantity: 1, unitPrice: -20, discountPct: 0, taxRate: 21, retentionRate: 15, isGlobalDiscount: true }]);
  });

  it("se recalcula al volver a aplicar (no acumula líneas de descuento)", () => {
    const once = applyGlobalDiscount(lines, { pct: 5 });
    const twice = applyGlobalDiscount(once, { pct: 10 });
    expect(twice.filter((line) => line.isGlobalDiscount)).toHaveLength(2);
    expect(calculateInvoiceTotals(twice).subtotal).toBe(990);
  });

  it("reparto por resto mayor", () => {
    expect(apportionCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportionCents(0, [1, 2])).toEqual([0, 0]);
    expect(apportionCents(10, [0, 0])).toEqual([0, 0]);
    expect(apportionCents(1001, [70000, 30000]).reduce((sum, share) => sum + share, 0)).toBe(1001);
  });
});

describe("anticipo descontado en la factura final", () => {
  it("resta base y cuota al mismo tipo", () => {
    const lines: InvoiceCalculationLine[] = [
      { description: "Obra completa", quantity: 1, unitPrice: 10000, taxes: [vat21] },
      { description: "Anticipo según factura F-2026/0007", quantity: 1, unitPrice: -3000, taxes: [vat21], advanceInvoiceId: "adv-1" },
    ];
    const totals = calculateInvoiceTotals(lines);
    expect(totals.taxBuckets).toEqual([{ name: "IVA 21%", kind: "VAT", rate: 21, operation: "ADD", baseAmount: 7000, amount: 1470 }]);
    expect(totals.totalAmount).toBe(8470);
    expect(summarizeInvoiceAmounts(lines, totals)).toMatchObject({ grossSubtotal: 10000, advanceDeductedAmount: 3000, subtotal: 7000, invoiceTotal: 8470 });
  });

  it("una línea negativa sin vínculo de anticipo sigue sin restar en una factura ordinaria", () => {
    const totals = calculateInvoiceTotals([
      { description: "Obra", quantity: 1, unitPrice: 100, taxes: [vat21] },
      { description: "Resta", quantity: 1, unitPrice: -30, taxes: [vat21] },
    ]);
    expect(totals.subtotal).toBe(100);
  });
});
