import { describe, expect, it } from "vitest";

import { computeCountDifferences, findStaleCountLines } from "@/lib/inventory-count";

describe("computeCountDifferences", () => {
  it("computes counted − system for counted rows and skips blank ones", () => {
    const result = computeCountDifferences([
      { itemId: "a", systemQuantity: 10, countedRaw: "12" },
      { itemId: "b", systemQuantity: 5, countedRaw: "3,5" },
      { itemId: "c", systemQuantity: 7, countedRaw: "7" },
      { itemId: "d", systemQuantity: 4, countedRaw: "" },
    ]);
    expect(result.counted.map((entry) => [entry.itemId, entry.difference])).toEqual([["a", 2], ["b", -1.5], ["c", 0]]);
    expect(result.adjustments.map((entry) => entry.itemId)).toEqual(["a", "b"]);
    expect(result.summary).toEqual({ countedItems: 3, adjustments: 2, unitsIn: 2, unitsOut: 1.5 });
  });

  it("counting zero units is a real count (removes all stock)", () => {
    const result = computeCountDifferences([{ itemId: "a", systemQuantity: 3, countedRaw: "0" }]);
    expect(result.adjustments).toEqual([{ itemId: "a", systemQuantity: 3, countedQuantity: 0, difference: -3 }]);
  });

  it("rejects invalid and negative quantities", () => {
    const result = computeCountDifferences([
      { itemId: "a", systemQuantity: 3, countedRaw: "abc" },
      { itemId: "b", systemQuantity: 3, countedRaw: "-1" },
    ]);
    expect(Object.keys(result.errors)).toEqual(["a", "b"]);
    expect(result.counted).toEqual([]);
  });

  it("avoids floating point noise in differences", () => {
    const [entry] = computeCountDifferences([{ itemId: "a", systemQuantity: 0.3, countedRaw: "0,1" }]).counted;
    expect(entry.difference).toBe(-0.2);
  });
});

describe("findStaleCountLines", () => {
  it("detects items whose stock changed after the sheet was opened", () => {
    const current = new Map([["a", 10], ["b", 4]]);
    expect(findStaleCountLines([{ itemId: "a", expectedQuantity: 10 }, { itemId: "b", expectedQuantity: 5 }, { itemId: "c", expectedQuantity: 0 }], current)).toEqual(["b"]);
  });
});
