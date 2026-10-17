import { describe, expect, it } from "vitest";

import { cartTotals, countDenominations, dailySales, exceedsSimplifiedLimit, expectedCash, grossPrice, netFromGross, remainingQuantities, splitRefund, validatePayment, type CartLine } from "@/modules/pos/model";

const line = (patch: Partial<CartLine>): CartLine => ({ key: Math.random().toString(36), itemId: null, description: "x", quantity: 1, unitPrice: 1, taxRate: 21, ...patch });

describe("pos cart", () => {
  it("totals like the issued invoice: VAT per rate on the sum of bases, with breakdown", () => {
    const totals = cartTotals([
      line({ quantity: 3, unitPrice: 0.33, taxRate: 21 }),
      line({ quantity: 1, unitPrice: 0.33, taxRate: 21 }),
      line({ quantity: 2, unitPrice: 1.5, taxRate: 10 }),
    ]);
    expect(totals.subtotal).toBe(4.32);
    // 21 %: base 1,32 → 0,28 (no 0,21 + 0,07 redondeados por línea); 10 %: base 3,00 → 0,30.
    expect(totals.taxBreakdown).toEqual([{ rate: 21, base: 1.32, tax: 0.28 }, { rate: 10, base: 3, tax: 0.3 }]);
    expect(totals.total).toBe(4.9);
  });

  it("makes the ticket total the sum of shelf prices, absorbing VAT rounding in one line", () => {
    // 2 × 2,00 € + 0,50 €: con bases de 2 decimales saldría 4,49 €.
    const coffee = line({ itemId: "cafe", quantity: 2, unitPrice: 1.65 });
    const bun = line({ quantity: 1, unitPrice: 0.41 });
    const totals = cartTotals([coffee, bun]);
    expect(totals.total).toBe(4.5);
    expect(totals.lines.map((entry) => entry.total)).toEqual([4, 0.5]);
    expect(totals.taxBreakdown).toEqual([{ rate: 21, base: 3.72, tax: 0.78 }]);
    expect(totals.settled.map((entry) => [entry.quantity, entry.unitPrice])).toEqual([[2, 1.65], [1, 0.42]]);
  });

  it("never charges more than the shelf prices when VAT cannot match them to the cent", () => {
    // 2 × 2,00 €: base 3,30 → 3,99 €; base 3,31 → 4,01 €. Se cobra 3,99 € y se muestra el redondeo.
    const totals = cartTotals([line({ quantity: 2, unitPrice: 1.65 })]);
    expect(totals.total).toBe(3.99);
    expect(totals.rounding).toBe(-0.01);
    expect(cartTotals([line({ quantity: 3, unitPrice: 1.65 })])).toMatchObject({ total: 6, rounding: 0 });
  });

  it("splits one unit off when every line has several, keeping item and quantities", () => {
    const totals = cartTotals([line({ itemId: "bollo", quantity: 3, unitPrice: 0.41 })]);
    expect(totals.total).toBe(1.5);
    expect(totals.settled.map((entry) => [entry.itemId, entry.quantity, entry.unitPrice])).toEqual([["bollo", 2, 0.41], ["bollo", 1, 0.42]]);
  });

  it("converts shelf prices (VAT included) to 2-decimal net prices", () => {
    expect(grossPrice(1.65, 21)).toBe(2);
    expect(netFromGross(2, 21)).toEqual({ net: 1.65, gross: 2, exact: true });
    expect(netFromGross(1.1, 10)).toEqual({ net: 1, gross: 1.1, exact: true });
    // 10,00 € al 21 % no tiene base exacta con 2 decimales: se acerca y lo indica.
    const tenEuros = netFromGross(10, 21);
    expect(tenEuros.exact).toBe(false);
    expect(Math.abs(tenEuros.gross - 10)).toBeLessThanOrEqual(0.01);
  });
});

describe("pos payment", () => {
  it("computes change and rejects wrong splits", () => {
    expect(validatePayment(12.34, { cash: 12.34, card: 0, cashReceived: 20 })).toEqual({ ok: true, change: 7.66 });
    expect(validatePayment(12.34, { cash: 2.34, card: 10, cashReceived: 5 })).toEqual({ ok: true, change: 2.66 });
    expect(validatePayment(12.34, { cash: 0, card: 12.34 })).toEqual({ ok: true, change: 0 });
    expect(validatePayment(12.34, { cash: 10, card: 0 })).toMatchObject({ ok: false });
    expect(validatePayment(12.34, { cash: 12.34, card: 0, cashReceived: 10 })).toMatchObject({ ok: false, message: expect.stringMatching(/no llega/) });
  });

  it("flags tickets over the simplified invoice limit", () => {
    expect(exceedsSimplifiedLimit(400, 400)).toBe(false);
    expect(exceedsSimplifiedLimit(400.01, 400)).toBe(true);
  });
});

describe("pos cash count", () => {
  it("adds coins and notes without float errors and computes the expected drawer", () => {
    expect(countDenominations({ "50": 1, "20": 2, "0.1": 3, "0.05": 1, "0.01": 2 })).toBe(90.37);
    expect(expectedCash({ openingCash: 50, cashSales: 120.4, cashRefunds: 10.2, cashIn: 5, cashOut: 100 })).toBe(65.2);
  });
});

describe("pos refunds", () => {
  it("refunds by the chosen method first and the rest by the other", () => {
    expect(splitRefund(4, { cash: 10, card: 0 }, "cash")).toEqual({ cash: 4, card: 0 });
    expect(splitRefund(4, { cash: 2.5, card: 7.5 }, "cash")).toEqual({ cash: 2.5, card: 1.5 });
    expect(splitRefund(4, { cash: 2.5, card: 7.5 }, "card")).toEqual({ cash: 0, card: 4 });
    expect(splitRefund(11, { cash: 10, card: 0 }, "cash")).toBeNull();
  });

  it("tracks what is left to return after partial refunds", () => {
    const remaining = remainingQuantities([{ id: "a", quantity: 3 }, { id: "b", quantity: 1 }], [{ lineId: "a", quantity: 1 }, { lineId: "a", quantity: 1.5 }]);
    expect(remaining.get("a")).toBe(0.5);
    expect(remaining.get("b")).toBe(1);
  });
});

describe("pos daily sales", () => {
  it("nets refunds per day in the company time zone", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    const result = dailySales([
      { kind: "SALE", total: 10, createdAt: "2026-10-16T08:00:00Z" },
      { kind: "REFUND", total: 2.5, createdAt: "2026-10-16T09:00:00Z" },
      // 23:30 del día 15 en Madrid (21:30 UTC).
      { kind: "SALE", total: 4.2, createdAt: "2026-10-15T21:30:00Z" },
      { kind: "SALE", total: 99, createdAt: "2026-09-01T10:00:00Z" },
    ], now, 3);
    expect(result.categories.map((day) => day.key)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(result.net).toEqual([0, 4.2, 7.5]);
    expect(result.count).toEqual([0, 1, 1]);
  });
});
