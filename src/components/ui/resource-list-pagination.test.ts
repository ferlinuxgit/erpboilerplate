import { describe, expect, it } from "vitest";

import { decimalRegisterOptions, moneyRegisterOptions } from "@/components/ui/number-input";
import { paginationRange } from "@/components/ui/resource-list";

describe("resource list pagination", () => {
  it("lists every page when there are few", () => {
    expect(paginationRange(1, 1)).toEqual([1]);
    expect(paginationRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("collapses long ranges around the current page", () => {
    expect(paginationRange(1, 12)).toEqual([1, 2, 3, 4, "…", 12]);
    expect(paginationRange(6, 12)).toEqual([1, "…", 5, 6, 7, "…", 12]);
    expect(paginationRange(12, 12)).toEqual([1, "…", 9, 10, 11, 12]);
  });
});

describe("decimal register options", () => {
  it("parses Spanish and dotted decimals for react-hook-form", () => {
    expect(decimalRegisterOptions.setValueAs("1,5")).toBe(1.5);
    expect(decimalRegisterOptions.setValueAs("2.125")).toBe(2.125);
    expect(moneyRegisterOptions.setValueAs("1.234,56")).toBe(1234.56);
    expect(moneyRegisterOptions.setValueAs("1.500")).toBe(1500);
    expect(moneyRegisterOptions.setValueAs(7)).toBe(7);
    expect(Number.isNaN(decimalRegisterOptions.setValueAs(""))).toBe(true);
  });
});
