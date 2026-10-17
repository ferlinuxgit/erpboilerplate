import { describe, expect, it } from "vitest";

import { cartTotals, countDenominations, exceedsSimplifiedLimit, expectedCash, grossPrice, netFromGross, validatePayment, type CartLine } from "@/modules/pos/model";

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
