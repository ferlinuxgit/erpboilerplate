import { describe, expect, it } from "vitest";

import { buildModelo420, buildModelo425, buildModelo450 } from "@/server/fiscal/canarias-calc";
import { computeIssuedVat, computeSupplierVat, type IssuedLineInput, type Modelo303Box, type SupplierLineInput } from "@/server/fiscal/spain-calc";

function issued(overrides: Partial<IssuedLineInput>): IssuedLineInput {
  return { invoiceId: "inv", number: "F-1", issueDate: new Date(Date.UTC(2026, 3, 10)), totalAmount: "0", treatment: "DOMESTIC", quantity: 1, unitPrice: 100, ...overrides };
}

function received(overrides: Partial<SupplierLineInput>): SupplierLineInput {
  return { invoiceId: "bill", number: "R-1", issueDate: new Date(Date.UTC(2026, 3, 12)), totalAmount: "0", treatment: "DOMESTIC", subtotal: 100, taxAmount: 7, taxRate: 7, ...overrides };
}

function box(boxes: Modelo303Box[], code: string) {
  return boxes.find((entry) => entry.box === code)?.amount;
}

const igic = (rate: number, base: number) => ({ rate, kind: "VAT", operation: "ADD" as const, baseAmount: base.toFixed(2), amount: ((base * rate) / 100).toFixed(2) });

describe("modelo 420 (IGIC trimestral)", () => {
  const sales = computeIssuedVat([
    issued({ invoiceId: "a", unitPrice: 1000, taxes: [igic(7, 1000)] }),
    issued({ invoiceId: "b", unitPrice: 200, taxes: [igic(3, 200)] }),
    issued({ invoiceId: "c", unitPrice: 50, taxes: [igic(0, 50)] }),
    issued({ invoiceId: "d", unitPrice: 300, treatment: "EXPORT", taxes: [] }),
    issued({ invoiceId: "e", unitPrice: 80, treatment: "NOT_SUBJECT", taxes: [] }),
  ]);
  const purchases = computeSupplierVat([
    received({ invoiceId: "p1", subtotal: 400, taxAmount: 28, taxRate: 7 }),
    received({ invoiceId: "p2", treatment: "REVERSE_CHARGE", subtotal: 100, taxAmount: 0, taxRate: 0 }),
  ], 100, 7);

  it("pone cada tipo en su fila (tipo cero incluido) y la inversión del sujeto pasivo en 19-20", () => {
    const { boxes } = buildModelo420(sales, purchases);
    // Filas por tipo ascendente: 0 % → 01/03, 3 % → 04/06, 7 % → 07/09.
    expect([box(boxes, "01"), box(boxes, "03"), box(boxes, "04"), box(boxes, "06"), box(boxes, "07"), box(boxes, "09")]).toEqual([50, 0, 200, 6, 1000, 70]);
    // Autorepercusión al 7 % (tipo general del IGIC).
    expect([box(boxes, "19"), box(boxes, "20")]).toEqual([100, 7]);
    expect(box(boxes, "25")).toBe(83);
  });

  it("deduce, calcula el resultado (25 − 40) e informa exportaciones (46) y no sujetas (47)", () => {
    const { boxes, resultCents } = buildModelo420(sales, purchases);
    expect([box(boxes, "26"), box(boxes, "27")]).toEqual([500, 35]);
    expect(box(boxes, "40")).toBe(35);
    expect(box(boxes, "41")).toBe(48);
    expect(box(boxes, "45")).toBe(48);
    expect(resultCents).toBe(4800);
    expect(box(boxes, "46")).toBe(300);
    expect(box(boxes, "47")).toBe(80);
  });
});

describe("modelo 425 (resumen anual del IGIC)", () => {
  it("régimen general: bases, devengado, deducible, resultado y volumen de operaciones", () => {
    const sales = computeIssuedVat([issued({ unitPrice: 1000, taxes: [igic(7, 1000)] }), issued({ invoiceId: "x", unitPrice: 300, treatment: "EXPORT", taxes: [] })]);
    const purchases = computeSupplierVat([received({ subtotal: 200, taxAmount: 14 })], 100, 7);
    const { boxes, resultCents } = buildModelo425(sales, purchases, "general");
    expect([box(boxes, "01"), box(boxes, "03"), box(boxes, "74"), box(boxes, "79"), box(boxes, "81"), box(boxes, "94"), box(boxes, "95"), box(boxes, "115")]).toEqual([1000, 70, 1000, 70, 14, 14, 56, 56]);
    expect([box(boxes, "120"), box(boxes, "122"), box(boxes, "134")]).toEqual([1000, 300, 1300]);
    expect(resultCents).toBe(5600);
  });

  it("comerciante minorista: sus ventas exentas van a la casilla 143", () => {
    const sales = computeIssuedVat([issued({ unitPrice: 500, treatment: "EXEMPT", taxes: [] })]);
    const { boxes } = buildModelo425(sales, computeSupplierVat([], 0, 7), "comerciante_minorista");
    expect(box(boxes, "143")).toBe(500);
    expect(box(boxes, "126")).toBeUndefined();
  });

  it("REPEP: solo el volumen de operaciones (142-147), sin resultado", () => {
    const sales = computeIssuedVat([issued({ unitPrice: 900, treatment: "EXEMPT", taxes: [] }), issued({ invoiceId: "y", unitPrice: 100, treatment: "NOT_SUBJECT", taxes: [] })]);
    const { boxes, resultCents } = buildModelo425(sales, computeSupplierVat([], 0, 7), "pequeno_empresario");
    expect([box(boxes, "142"), box(boxes, "144"), box(boxes, "147")]).toEqual([900, 100, 1000]);
    expect(resultCents).toBe(0);
  });
});

describe("modelo 450 (AIEM)", () => {
  it("cuotas por tipo, total (casilla 6) y resultado (15)", () => {
    const { boxes, resultCents } = buildModelo450([
      { rate: 15, baseCents: 100000, taxCents: 15000 },
      { rate: 5, baseCents: 20000, taxCents: 1000 },
    ]);
    expect(boxes.filter((entry) => entry.box === "").map((entry) => entry.label)).toEqual(["Base imponible AIEM al 5 %", "Cuota AIEM al 5 %", "Base imponible AIEM al 15 %", "Cuota AIEM al 15 %"]);
    expect([box(boxes, "6"), box(boxes, "15")]).toEqual([160, 160]);
    expect(resultCents).toBe(16000);
  });
});
