import { describe, expect, it } from "vitest";

import { calculateInvoiceTotals } from "@/lib/invoice-totals";
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

describe("descuento por línea en facturas", () => {
  it("aplica el % de descuento a la base antes de impuestos (motor fiscal único)", () => {
    const lines = [
      { description: "Consultoría", quantity: 3, unitPrice: 100, discountPct: 10, taxes: [{ id: "vat", name: "IVA", rate: 21, kind: "VAT", operation: "ADD" as const }, { id: "irpf", name: "IRPF", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" as const }] },
      { description: "Soporte", quantity: 1, unitPrice: 50, discountPct: 0, taxes: [{ id: "vat", name: "IVA", rate: 21, kind: "VAT", operation: "ADD" as const }] },
    ];
    const totals = calculateInvoiceTotals(lines);
    // 3 × 100 × 0,9 = 270; +50 = 320 de base; IVA 67,20; IRPF 40,50.
    expect(totals).toMatchObject({ subtotal: 320, taxAmount: 67.2, retentionAmount: 40.5, totalAmount: 346.7 });
    const values = buildInvoiceLineInsertValues("invoice-1", lines, ["l1", "l2"]);
    expect(values[0]).toMatchObject({ discountPct: "10.000", lineTotal: "286.20" });
    const taxRows = buildInvoiceLineTaxInsertValues(["l1", "l2"], lines);
    expect(taxRows[0]).toMatchObject({ baseAmount: "270.00", amount: "56.70" });
  });
});
