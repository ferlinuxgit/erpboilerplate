import { describe, expect, it } from "vitest";

import { buildInvoiceLineInsertValues } from "@/server/invoices/line-values";

describe("buildInvoiceLineInsertValues", () => {
  it("uses discounted and retained line totals", () => {
    const [line] = buildInvoiceLineInsertValues("invoice-1", [
      {
        itemId: "item-1",
        description: "Consultoría",
        quantity: 2,
        unitPrice: 100,
        discountPct: 10,
        taxRate: 21,
        retentionRate: 15,
      },
    ]);

    expect(line).toMatchObject({
      invoiceId: "invoice-1",
      quantity: "2.000",
      unitPrice: "100.00",
      taxRate: "21.000",
      lineTotal: "190.80",
    });
  });
});
