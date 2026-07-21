import { describe, expect, it } from "vitest";

import { calculateSupplierBalance } from "@/lib/supplier-balance";

describe("calculateSupplierBalance", () => {
  it("subtracts invoice payments and payments on account from the supplier balance", () => {
    expect(calculateSupplierBalance(1_000, 350)).toEqual({
      netBalance: 650,
      outstandingBalance: 650,
      creditBalance: 0,
    });
  });

  it("keeps excess payments as supplier credit instead of a negative pending balance", () => {
    expect(calculateSupplierBalance(200, 275)).toEqual({
      netBalance: -75,
      outstandingBalance: 0,
      creditBalance: 75,
    });
  });
});
