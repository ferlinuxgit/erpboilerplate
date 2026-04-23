import { describe, expect, it } from "vitest";

import { computeDocumentTotals, computeLineAmounts } from "@/server/taxation/engine";

describe("taxation engine", () => {
  it("calcula una linea con IVA 21%", () => {
    const result = computeLineAmounts({ quantity: 2, unitPrice: 100, taxRate: 21 });
    expect(result).toEqual({
      base: 200,
      taxAmount: 42,
      retentionAmount: 0,
      total: 242,
    });
  });

  it("calcula retencion IRPF", () => {
    const result = computeLineAmounts({ quantity: 1, unitPrice: 1000, taxRate: 21, retentionRate: 15 });
    expect(result.total).toBe(1060);
  });

  it("agrega totales de documento", () => {
    const result = computeDocumentTotals([
      { quantity: 1, unitPrice: 100, taxRate: 21 },
      { quantity: 3, unitPrice: 50, taxRate: 10, discountPct: 10 },
    ]);
    expect(result.subtotal).toBe(235);
    expect(result.taxAmount).toBe(34.5);
    expect(result.totalAmount).toBe(269.5);
  });
});
