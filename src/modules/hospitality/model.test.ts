import { describe, expect, it } from "vitest";

import { cartTotals } from "@/modules/pos/model";

import { billPartLines, formatElapsed, orderAmounts, type OrderLine } from "./model";

const line = (patch: Partial<OrderLine>): OrderLine => ({ id: Math.random().toString(36).slice(2), itemId: null, description: "x", quantity: 1, unitPrice: 1, taxRate: 10, taxId: null, note: null, station: "NONE", status: "SENT", paidQuantity: 0, ...patch });

// Caña 2,20 € (10 %), menú 14,30 € (10 %), vino 3,63 € (21 %).
const cana = line({ id: "cana", description: "Caña", quantity: 3, unitPrice: 2, taxRate: 10 });
const menu = line({ id: "menu", description: "Menú del día", quantity: 2, unitPrice: 13, taxRate: 10 });
const vino = line({ id: "vino", description: "Copa de vino", quantity: 1, unitPrice: 3, taxRate: 21 });
const lines = [cana, menu, vino];

describe("hospitality bill", () => {
  it("adds the bill like shelf prices and ignores cancelled lines", () => {
    expect(orderAmounts([...lines, line({ quantity: 5, unitPrice: 9, status: "CANCELLED" })])).toEqual({ total: 38.83, pending: 38.83, paid: 0 });
  });

  it("charges everything pending in one ticket", () => {
    const result = billPartLines(lines, { mode: "all" }, null, "Mesa 4");
    if ("error" in result) throw new Error(result.error);
    expect(cartTotals(result.cart).total).toBe(38.83);
    expect(result.closes).toBe(true);
  });

  it("charges chosen units and keeps the rest pending", () => {
    const result = billPartLines(lines, { mode: "lines", lines: [{ lineId: "cana", quantity: 2 }, { lineId: "vino", quantity: 1 }] }, null, "Mesa 4");
    if ("error" in result) throw new Error(result.error);
    expect(cartTotals(result.cart).total).toBe(8.03);
    expect(result.closes).toBe(false);
    const after = lines.map((entry) => ({ ...entry, paidQuantity: result.paidQuantities.get(entry.id) ?? entry.paidQuantity }));
    expect(orderAmounts(after).pending).toBe(30.8);
    expect(billPartLines(after, { mode: "lines", lines: [{ lineId: "cana", quantity: 2 }] }, null, "Mesa 4")).toMatchObject({ error: expect.stringMatching(/solo quedan 1/) });
  });

  it("charges a set menu together with its dishes (at 0 €) so the bill can close", () => {
    const sopa = line({ id: "sopa", description: "Sopa", quantity: 2, unitPrice: 0, parentLineId: "menu", station: "KITCHEN" });
    const pollo = line({ id: "pollo", description: "Pollo", quantity: 2, unitPrice: 0, parentLineId: "menu", station: "KITCHEN" });
    const all = [menu, sopa, pollo];
    const half = billPartLines(all, { mode: "lines", lines: [{ lineId: "menu", quantity: 1 }] }, null, "Mesa 4");
    if ("error" in half) throw new Error(half.error);
    expect(half.cart.map((entry) => [entry.description, entry.quantity])).toEqual([["Menú del día", 1], ["Sopa", 1], ["Pollo", 1]]);
    expect(half.closes).toBe(false);
    const after = all.map((entry) => ({ ...entry, paidQuantity: half.paidQuantities.get(entry.id) ?? entry.paidQuantity }));
    const rest = billPartLines(after, { mode: "lines", lines: [{ lineId: "menu", quantity: 1 }] }, null, "Mesa 4");
    if ("error" in rest) throw new Error(rest.error);
    expect(rest.closes).toBe(true);
    expect(cartTotals(rest.cart).total).toBe(14.3);
  });

  it("splits into equal parts per VAT rate; the last part takes the leftover cents and closes the bill", () => {
    let split = null as ReturnType<typeof billPartLines> extends infer R ? R extends { equalSplit: infer E } ? E : never : never;
    const totals: number[] = [];
    let current = lines;
    for (let index = 0; index < 3; index += 1) {
      const result = billPartLines(current, { mode: "equal", parts: 3 }, split, "Mesa 4");
      if ("error" in result) throw new Error(result.error);
      totals.push(cartTotals(result.cart).total);
      split = result.equalSplit;
      if (result.closes) current = current.map((entry) => ({ ...entry, paidQuantity: result.paidQuantities.get(entry.id) ?? entry.paidQuantity }));
      expect(result.closes).toBe(index === 2);
      if (index === 0) expect(orderAmounts(current, split).pending).toBe(25.89);
    }
    // 38,83 € entre 3: los céntimos sobrantes van a la última parte y suman exactamente el total.
    expect(totals.reduce((sum, value) => Math.round((sum + value) * 100) / 100, 0)).toBe(38.83);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(0.02);
    expect(orderAmounts(current).pending).toBe(0);
  });

  it("does not mix item payments with an equal split in progress", () => {
    const first = billPartLines(lines, { mode: "equal", parts: 2 }, null, "Mesa 4");
    if ("error" in first) throw new Error(first.error);
    expect(billPartLines(lines, { mode: "lines", lines: [{ lineId: "cana", quantity: 1 }] }, first.equalSplit, "Mesa 4")).toMatchObject({ error: expect.stringMatching(/partes iguales/) });
    // «Cobrar el resto» cierra la división.
    const rest = billPartLines(lines, { mode: "all" }, first.equalSplit, "Mesa 4");
    if ("error" in rest) throw new Error(rest.error);
    expect(rest.closes).toBe(true);
    // Nunca se cobra más que la cuenta (como mucho algún céntimo menos por el redondeo del IVA).
    const charged = Math.round((cartTotals(first.cart).total + cartTotals(rest.cart).total) * 100) / 100;
    expect(charged).toBeLessThanOrEqual(38.83);
    expect(charged).toBeGreaterThanOrEqual(38.81);
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(7)).toBe("7 min");
    expect(formatElapsed(95)).toBe("1 h 35");
  });
});
