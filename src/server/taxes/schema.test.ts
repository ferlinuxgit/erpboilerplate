import { describe, expect, it } from "vitest";

import { operationForTaxKind, taxMutationSchema, taxPatchSchema } from "@/server/taxes/schema";

describe("tax schemas", () => {
  it("forces common Spanish tax types to use their legal direction", () => {
    expect(operationForTaxKind("VAT", "SUBTRACT")).toBe("ADD");
    expect(operationForTaxKind("SURCHARGE", "SUBTRACT")).toBe("ADD");
    expect(operationForTaxKind("WITHHOLDING", "ADD")).toBe("SUBTRACT");
  });

  it("does not apply create defaults to partial updates", () => {
    expect(taxPatchSchema.parse({ isActive: true })).toEqual({ isActive: true });
    expect(taxMutationSchema.parse({ name: "IVA general", rate: 21 })).toMatchObject({
      kind: "VAT",
      isDefault: false,
      isActive: true,
    });
  });
});
