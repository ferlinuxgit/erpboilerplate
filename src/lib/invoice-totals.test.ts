import { describe, expect, it } from "vitest";

import { calculateInvoiceTotals } from "@/lib/invoice-totals";

describe("calculateInvoiceTotals", () => {
  it("applies discount and retention when calculating totals", () => {
    const totals = calculateInvoiceTotals([
      {
        description: "Consultoría",
        quantity: 2,
        unitPrice: 100,
        discountPct: 10,
        taxRate: 21,
        retentionRate: 15,
      },
    ]);

    expect(totals.lines).toEqual([{ subtotal: 180, taxAmount: 37.8, retentionAmount: 27, lineTotal: 190.8 }]);
    expect(totals).toMatchObject({ subtotal: 180, taxAmount: 37.8, retentionAmount: 27, totalAmount: 190.8 });
  });
});
