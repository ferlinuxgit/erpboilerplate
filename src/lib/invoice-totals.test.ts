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

    expect(totals.lines[0]).toMatchObject({ subtotal: 180, taxAmount: 37.8, retentionAmount: 27, lineTotal: 190.8 });
    expect(totals).toMatchObject({ subtotal: 180, taxAmount: 37.8, retentionAmount: 27, totalAmount: 190.8 });
  });

  it("supports multiple additive taxes and negative-effect withholdings", () => {
    const totals = calculateInvoiceTotals([
      {
        description: "Servicio profesional",
        quantity: 1,
        unitPrice: 1_000,
        taxes: [
          { id: "vat", name: "IVA general", rate: 21, kind: "VAT", operation: "ADD" },
          { id: "surcharge", name: "Recargo", rate: 5.2, kind: "SURCHARGE", operation: "ADD" },
          { id: "irpf", name: "IRPF", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" },
        ],
      },
    ]);

    expect(totals).toMatchObject({
      subtotal: 1_000,
      taxAmount: 262,
      retentionAmount: 150,
      totalAmount: 1_112,
    });
    expect(totals.lines[0]?.taxes).toEqual([
      expect.objectContaining({ id: "vat", amount: 210, operation: "ADD" }),
      expect.objectContaining({ id: "surcharge", amount: 52, operation: "ADD" }),
      expect.objectContaining({ id: "irpf", amount: 150, operation: "SUBTRACT" }),
    ]);
  });

  it("allows removing every tax from a line that had a legacy VAT rate", () => {
    const totals = calculateInvoiceTotals([{ description: "Sin impuesto", quantity: 1, unitPrice: 100, taxRate: 21, taxes: [] }]);

    expect(totals).toMatchObject({ subtotal: 100, taxAmount: 0, retentionAmount: 0, totalAmount: 100 });
  });

  it("exposes per-rate tax buckets computed on the summed base", () => {
    const totals = calculateInvoiceTotals([
      { description: "A", quantity: 1, unitPrice: 0.35, taxRate: 21 },
      { description: "B", quantity: 1, unitPrice: 0.35, taxRate: 21 },
      { description: "C", quantity: 1, unitPrice: 0.35, taxRate: 21 },
      { description: "D", quantity: 1, unitPrice: 10, taxRate: 10, retentionRate: 15 },
    ]);

    expect(totals.taxBuckets).toEqual([
      { name: "IVA", kind: "VAT", rate: 21, operation: "ADD", baseAmount: 1.05, amount: 0.22 },
      { name: "IVA", kind: "VAT", rate: 10, operation: "ADD", baseAmount: 10, amount: 1 },
      { name: "Retención", kind: "WITHHOLDING", rate: 15, operation: "SUBTRACT", baseAmount: 10, amount: 1.5 },
    ]);
    expect(totals.lines.reduce((sum, line) => sum + line.taxAmount, 0)).toBeCloseTo(1.21, 10);
    expect(totals).toMatchObject({ subtotal: 11.05, taxAmount: 1.22, retentionAmount: 1.5, totalAmount: 10.77 });
  });
});
