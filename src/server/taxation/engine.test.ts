import { describe, expect, it } from "vitest";

import {
  amountToCents,
  centsToNumber,
  computeDocumentTotals,
  computeEngineDocument,
  computeEngineLine,
  computeLineAmounts,
  legacyLineTaxes,
  lineBaseCents,
  roundHalfAwayFromZero,
  taxOnBaseCents,
} from "@/server/taxation/engine";

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

describe("motor fiscal en céntimos", () => {
  const vat21 = { name: "IVA", rate: 21, kind: "VAT", operation: "ADD" as const };

  it("redondea la base de cada línea a céntimos con un único redondeo", () => {
    expect(lineBaseCents({ quantity: 3, unitPrice: 0.333 })).toBe(100);
    expect(lineBaseCents({ quantity: 1, unitPrice: 1.005 })).toBe(101);
    expect(lineBaseCents({ quantity: 2, unitPrice: 100, discountPct: 10 })).toBe(18_000);
    expect(amountToCents("12,345")).toBe(1235);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(centsToNumber(12_345)).toBe(123.45);
  });

  it("calcula la cuota por bucket, no sumando cuotas de línea redondeadas", () => {
    const lines = [0, 1, 2].map(() => ({ quantity: 1, unitPrice: 0.35, taxes: [vat21] }));
    const result = computeEngineDocument(lines);

    // Línea a línea: 0,0735 → 0,07 × 3 = 0,21. Por bucket: 1,05 × 21 % = 0,2205 → 0,22.
    expect(result.lines.reduce((sum, line) => sum + line.taxCents, 0)).toBe(21);
    expect(result.buckets).toEqual([expect.objectContaining({ key: "ADD|VAT|21", baseCents: 105, amountCents: 22 })]);
    expect(result).toMatchObject({ subtotalCents: 105, taxCents: 22, retentionCents: 0, totalCents: 127 });
  });

  it("separa buckets por tipo y aplica descuentos antes del impuesto", () => {
    const result = computeEngineDocument([
      { quantity: 2, unitPrice: 100, discountPct: 10, taxes: [vat21] },
      { quantity: 1, unitPrice: 50, taxes: [{ ...vat21, rate: 10 }] },
    ]);
    expect(result.buckets.map((bucket) => [bucket.key, bucket.baseCents, bucket.amountCents])).toEqual([
      ["ADD|VAT|21", 18_000, 3_780],
      ["ADD|VAT|10", 5_000, 500],
    ]);
    expect(result.totalCents).toBe(18_000 + 5_000 + 3_780 + 500);
  });

  it("resta retenciones y suma recargo de equivalencia", () => {
    const result = computeEngineDocument([
      {
        quantity: 1,
        unitPrice: 1_000,
        taxes: [
          vat21,
          { name: "RE", rate: 5.2, kind: "SURCHARGE", operation: "ADD" },
          { name: "IRPF", rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" },
        ],
      },
    ]);
    expect(result).toMatchObject({ subtotalCents: 100_000, taxCents: 26_200, retentionCents: 15_000, totalCents: 111_200 });
    expect(result.buckets).toHaveLength(3);
  });

  it("admite líneas negativas solo con allowNegative", () => {
    const lines = [
      { quantity: 1, unitPrice: 100, taxes: [vat21] },
      { quantity: -1, unitPrice: 40, taxes: [vat21] },
    ];
    expect(computeEngineDocument(lines, { allowNegative: true })).toMatchObject({ subtotalCents: 6_000, taxCents: 1_260, totalCents: 7_260 });
    expect(computeEngineDocument(lines)).toMatchObject({ subtotalCents: 10_000, taxCents: 2_100, totalCents: 12_100 });
    expect(computeEngineLine({ quantity: 1, unitPrice: -40, taxes: [vat21] })).toMatchObject({ baseCents: 0, taxCents: 0, totalCents: 0 });
    expect(computeEngineLine({ quantity: -1, unitPrice: 40, taxes: [vat21] }, { allowNegative: true })).toMatchObject({
      baseCents: -4_000,
      taxCents: -840,
      totalCents: -4_840,
    });
  });

  it("deduce los impuestos legacy de tipo de IVA y retención", () => {
    expect(legacyLineTaxes({ taxRate: 21, retentionRate: 15 })).toEqual([
      expect.objectContaining({ rate: 21, kind: "VAT", operation: "ADD" }),
      expect.objectContaining({ rate: 15, kind: "WITHHOLDING", operation: "SUBTRACT" }),
    ]);
    expect(legacyLineTaxes({ taxRate: 0, retentionRate: 0 })).toEqual([]);
  });

  it("mantiene computeLineAmounts / computeDocumentTotals alineados con el motor", () => {
    const lines = [0, 1, 2].map(() => ({ quantity: 1, unitPrice: 0.35, taxRate: 21 }));
    expect(computeLineAmounts(lines[0])).toEqual({ base: 0.35, taxAmount: 0.07, retentionAmount: 0, total: 0.42 });
    expect(computeDocumentTotals(lines)).toEqual({ subtotal: 1.05, taxAmount: 0.22, retentionAmount: 0, totalAmount: 1.27 });
    expect(taxOnBaseCents(105, 21)).toBe(22);
  });
});
