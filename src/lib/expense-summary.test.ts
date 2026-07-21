import { describe, expect, it } from "vitest";

import { summarizeExpenses } from "@/lib/expense-summary";

describe("summarizeExpenses", () => {
  it("excludes void expenses from every operational total", () => {
    expect(summarizeExpenses([
      { status: "POSTED", totalAmount: "121.00", outstandingAmount: "50.00", taxAmount: "21.00" },
      { status: "VOID", totalAmount: "242.00", outstandingAmount: "242.00", taxAmount: "42.00" },
    ])).toEqual({
      activeCount: 1,
      voidCount: 1,
      totalAmount: 121,
      pendingAmount: 50,
      inputTaxAmount: 21,
    });
  });
});
