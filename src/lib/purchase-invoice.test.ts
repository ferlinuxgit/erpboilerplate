import { describe, expect, it } from "vitest";

import {
  buildReceiptInvoiceLines,
  invoiceQuantityProblem,
  isOrderFullyInvoiced,
  priceVariance,
  quantitiesByOrderLine,
  receiptInvoiceTotals,
  type OrderLineRef,
  type ReceiptLineRef,
} from "@/lib/purchase-invoice";

// Mismo artículo en dos líneas del pedido con precios distintos: la trazabilidad debe ser por línea.
const orderLines: OrderLineRef[] = [
  { id: "pol-1", itemId: "tornillo", description: "Tornillos caja 100", quantity: 10, unitPrice: 5 },
  { id: "pol-2", itemId: "tornillo", description: "Tornillos caja 100 (oferta)", quantity: 4, unitPrice: 4 },
  { id: "pol-3", itemId: "tuerca", description: "Tuercas", quantity: 20, unitPrice: 0.5 },
];

const receiptLines: ReceiptLineRef[] = [
  { id: "grl-1", goodsReceiptId: "gr-1", goodsReceiptNumber: "ALB-1", purchaseOrderLineId: "pol-1", itemId: "tornillo", itemName: "Tornillos", quantity: 6 },
  { id: "grl-2", goodsReceiptId: "gr-1", goodsReceiptNumber: "ALB-1", purchaseOrderLineId: "pol-3", itemId: "tuerca", itemName: "Tuercas", quantity: 20 },
  { id: "grl-3", goodsReceiptId: "gr-2", goodsReceiptNumber: "ALB-2", purchaseOrderLineId: "pol-1", itemId: "tornillo", itemName: "Tornillos", quantity: 4 },
  { id: "grl-4", goodsReceiptId: "gr-2", goodsReceiptNumber: "ALB-2", purchaseOrderLineId: "pol-2", itemId: "tornillo", itemName: "Tornillos", quantity: 4 },
];

describe("buildReceiptInvoiceLines", () => {
  it("proposes one line per received line with the price of its own order line", () => {
    const lines = buildReceiptInvoiceLines({ receiptLines, orderLines, itemTaxRates: new Map([["tornillo", 21]]), fallbackTaxRate: null });
    expect(lines.map((line) => [line.goodsReceiptLineId, line.purchaseOrderLineId, line.unitPrice])).toEqual([
      ["grl-1", "pol-1", 5],
      ["grl-2", "pol-3", 0.5],
      ["grl-3", "pol-1", 5],
      ["grl-4", "pol-2", 4],
    ]);
  });

  it("never proposes a silent 0 % VAT when the item has no tax", () => {
    const [, tuerca] = buildReceiptInvoiceLines({ receiptLines, orderLines, itemTaxRates: new Map([["tornillo", 21]]), fallbackTaxRate: null });
    expect(tuerca.taxRateSource).toBe("none");
    expect(Number.isNaN(tuerca.taxRate)).toBe(true);
    const [, withFallback] = buildReceiptInvoiceLines({ receiptLines, orderLines, itemTaxRates: new Map(), fallbackTaxRate: 21 });
    expect(withFallback).toMatchObject({ taxRate: 21, taxRateSource: "default" });
  });
});

describe("receiptInvoiceTotals", () => {
  it("totals an invoice that covers two receipts", () => {
    const lines = buildReceiptInvoiceLines({ receiptLines, orderLines, itemTaxRates: new Map([["tornillo", 21], ["tuerca", 10]]) });
    // 6×5 + 4×5 + 4×4 = 66 € al 21 % (13,86) y 20×0,5 = 10 € al 10 % (1,00)
    expect(receiptInvoiceTotals(lines)).toEqual({ subtotal: 76, tax: 14.86, total: 90.86 });
  });

  it("rounds each line base to cents", () => {
    expect(receiptInvoiceTotals([{ quantity: 3, unitPrice: 1.115, taxRate: 21 }])).toEqual({ subtotal: 3.35, tax: 0.7, total: 4.05 });
  });
});

describe("priceVariance", () => {
  it("flags invoice prices that differ from the order", () => {
    expect(priceVariance(5, 5)).toEqual({ difference: 0, pct: 0, significant: false });
    expect(priceVariance(5, 5.5)).toMatchObject({ difference: 0.5, pct: 10, significant: true });
    expect(priceVariance(0, 2)).toMatchObject({ significant: true, pct: 100 });
  });
});

describe("quantity control by order line", () => {
  it("allocates legacy records without order line by item, in order", () => {
    const received = quantitiesByOrderLine(orderLines, [{ purchaseOrderLineId: null, itemId: "tornillo", quantity: 12 }]);
    expect([...received.entries()]).toEqual([["pol-1", 10], ["pol-2", 2]]);
  });

  it("rejects invoicing more than ordered or received on a line", () => {
    const received = quantitiesByOrderLine(orderLines, receiptLines);
    const alreadyInvoiced = new Map([["pol-1", 6]]);
    expect(invoiceQuantityProblem({ orderLines, received, alreadyInvoiced, requested: new Map([["pol-1", 4], ["pol-2", 4]]) })).toBeNull();
    expect(invoiceQuantityProblem({ orderLines, received, alreadyInvoiced, requested: new Map([["pol-1", 5]]) })).toMatch(/supera la pedida/);
    const partialReceipt = quantitiesByOrderLine(orderLines, receiptLines.slice(0, 2));
    expect(invoiceQuantityProblem({ orderLines, received: partialReceipt, alreadyInvoiced: new Map(), requested: new Map([["pol-1", 8]]) })).toMatch(/supera la recibida/);
    expect(invoiceQuantityProblem({ orderLines, received, alreadyInvoiced: new Map(), requested: new Map([["otra", 1]]) })).toMatch(/no pertenece/);
  });

  it("knows when the whole order is invoiced", () => {
    expect(isOrderFullyInvoiced(orderLines, new Map([["pol-1", 10], ["pol-2", 4], ["pol-3", 20]]))).toBe(true);
    expect(isOrderFullyInvoiced(orderLines, new Map([["pol-1", 10], ["pol-3", 20]]))).toBe(false);
  });
});
