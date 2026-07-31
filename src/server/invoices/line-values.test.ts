import { describe, expect, it } from "vitest";

import { buildInvoiceLineInsertValues, buildInvoiceLineTaxInsertValues } from "@/server/invoices/line-values";

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

  it("stores tax snapshots separately for every selected tax", () => {
    const lines = [{
      description: "Servicio",
      quantity: 1,
      unitPrice: 100,
      taxes: [
        { id: "vat-21", name: "IVA general", rate: 21, kind: "VAT", operation: "ADD" as const },
        { id: "irpf-15", name: "IRPF profesional", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" as const },
      ],
    }];

    expect(buildInvoiceLineTaxInsertValues(["line-1"], lines)).toEqual([
      expect.objectContaining({ invoiceLineId: "line-1", taxId: "vat-21", name: "IVA general", amount: "21.00", operation: "ADD" }),
      expect.objectContaining({ invoiceLineId: "line-1", taxId: "irpf-15", name: "IRPF profesional", amount: "15.00", operation: "SUBTRACT" }),
    ]);
  });
});
