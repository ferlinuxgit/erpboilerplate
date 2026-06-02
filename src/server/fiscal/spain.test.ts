import { describe, expect, it } from "vitest";

import { aggregateOutputVat, aggregateWithholdings } from "@/lib/fiscal-spain";

describe("Spanish fiscal VAT aggregation", () => {
  it("groups invoice lines by VAT rate and rounds tax amounts", () => {
    const buckets = aggregateOutputVat([
      { quantity: "2", unitPrice: "100", taxRate: "21" },
      { quantity: "1", unitPrice: "50", taxRate: "21" },
      { quantity: "3", unitPrice: "10", taxRate: "10" },
      { quantity: "1", unitPrice: "15", taxRate: "0" },
    ]);

    expect(buckets).toEqual([
      { rate: 21, base: 250, tax: 52.5 },
      { rate: 10, base: 30, tax: 3 },
      { rate: 0, base: 15, tax: 0 },
    ]);
  });

  it("uses discounted bases for VAT and withholding buckets", () => {
    expect(aggregateOutputVat([{ quantity: "1", unitPrice: "100", discountPct: "10", taxRate: "21" }])).toEqual([
      { rate: 21, base: 90, tax: 18.9 },
    ]);

    expect(aggregateWithholdings([{ quantity: "1", unitPrice: "100", discountPct: "10", retentionRate: "15" }])).toEqual([
      { rate: 15, base: 90, tax: 13.5 },
    ]);
  });
});
