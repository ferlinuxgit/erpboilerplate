import { describe, expect, it } from "vitest";

import { describeCustomerPricing, resolveLinePrice, type CustomerPricing } from "@/lib/pricing";

const item = { id: "a", salePrice: 10 };
const list = (adjustmentPct: number, prices: Record<string, number> = {}): CustomerPricing["priceList"] => ({ id: "l", name: "Mayoristas", adjustmentPct, prices });

describe("resolveLinePrice", () => {
  it("uses the sale price without a price list or group", () => {
    expect(resolveLinePrice(item)).toEqual({ unitPrice: 10, discountPct: 0, source: "base" });
  });

  it("prefers the item's own price in the list", () => {
    expect(resolveLinePrice(item, { priceList: list(-10, { a: 7.5 }), group: null })).toEqual({ unitPrice: 7.5, discountPct: 0, source: "list" });
  });

  it("applies the list adjustment to items without their own price, rounded to cents", () => {
    expect(resolveLinePrice({ id: "b", salePrice: 9.99 }, { priceList: list(-15), group: null })).toEqual({ unitPrice: 8.49, discountPct: 0, source: "adjusted" });
    expect(resolveLinePrice(item, { priceList: list(25), group: null }).unitPrice).toBe(12.5);
    expect(resolveLinePrice(item, { priceList: list(-100), group: null }).unitPrice).toBe(0);
  });

  it("adds the group discount as a line discount", () => {
    const pricing: CustomerPricing = { priceList: list(0, { a: 8 }), group: { id: "g", name: "Socios", discountPct: 5 } };
    expect(resolveLinePrice(item, pricing)).toEqual({ unitPrice: 8, discountPct: 5, source: "list" });
    expect(resolveLinePrice({ id: "z", salePrice: 4 }, pricing)).toEqual({ unitPrice: 4, discountPct: 5, source: "base" });
  });
});

describe("describeCustomerPricing", () => {
  it("explains the list and the group discount", () => {
    expect(describeCustomerPricing({ priceList: list(0), group: { id: "g", name: "Socios", discountPct: 2.5 } })).toBe("Precios con tarifa «Mayoristas» y 2,5 % de descuento del grupo «Socios».");
    expect(describeCustomerPricing({ priceList: null, group: { id: "g", name: "Socios", discountPct: 0 } })).toBeNull();
  });
});
