import { describe, expect, it } from "vitest";

import { addDaysToDateInput, applySupplierDefaultsToLine, computeDueDate, dueDateInputFor, supplierDefaultsFromRow, type SupplierDefaults } from "@/lib/supplier-defaults";

const defaults: SupplierDefaults = {
  defaultExpenseAccountId: "acc-628",
  defaultRetentionRate: 15,
  defaultTaxDeductiblePct: 50,
  defaultVatTreatment: "DOMESTIC",
  paymentTermsDays: 30,
};

const baseLine = { expenseAccountId: "", accountSource: "none" as const, taxDeductiblePct: "100", retentionRate: "0" };

describe("due date", () => {
  it("adds the supplier payment terms to the issue date, across months and leap years", () => {
    expect(addDaysToDateInput("2026-01-31", 30)).toBe("2026-03-02");
    expect(addDaysToDateInput("2028-02-15", 15)).toBe("2028-03-01");
    expect(dueDateInputFor("2026-09-25", 60)).toBe("2026-11-24");
  });

  it("treats 0 days as cash and missing terms as no due date", () => {
    expect(dueDateInputFor("2026-09-25", 0)).toBe("2026-09-25");
    expect(dueDateInputFor("2026-09-25", null)).toBe("");
    expect(dueDateInputFor("", 30)).toBe("");
  });

  it("computes the same due date on the server", () => {
    expect(computeDueDate(new Date("2026-09-25T12:00:00.000Z"), 30)?.toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(computeDueDate(new Date("2026-09-25T12:00:00.000Z"), null)).toBeUndefined();
  });
});

describe("applySupplierDefaultsToLine", () => {
  it("fills account, IRPF and deductible % on an empty line", () => {
    expect(applySupplierDefaultsToLine(baseLine, defaults)).toEqual({
      expenseAccountId: "acc-628",
      accountSource: "supplier",
      taxDeductiblePct: "50",
      retentionRate: "15",
    });
  });

  it("never overrides an account proposed by the document or chosen by the user", () => {
    expect(applySupplierDefaultsToLine({ ...baseLine, expenseAccountId: "acc-621", accountSource: "ai" as const }, defaults).expenseAccountId).toBe("acc-621");
    expect(applySupplierDefaultsToLine({ ...baseLine, expenseAccountId: "acc-629", accountSource: "user" as const }, defaults)).toMatchObject({ expenseAccountId: "acc-629", accountSource: "user" });
  });

  it("keeps the retention read from the document and a deductible edited by hand", () => {
    const line = applySupplierDefaultsToLine({ ...baseLine, retentionRate: "7", taxDeductiblePct: "100" }, defaults, { userEditedDeductible: true });
    expect(line.retentionRate).toBe("7");
    expect(line.taxDeductiblePct).toBe("100");
    expect(applySupplierDefaultsToLine(baseLine, defaults, { documentHasRetention: true }).retentionRate).toBe("0");
  });

  it("does nothing when the supplier has no defaults", () => {
    expect(applySupplierDefaultsToLine(baseLine, supplierDefaultsFromRow({}))).toEqual(baseLine);
  });
});

describe("supplierDefaultsFromRow", () => {
  it("parses numeric strings and rejects unknown VAT treatments", () => {
    expect(supplierDefaultsFromRow({ defaultRetentionRate: "15.000", defaultTaxDeductiblePct: null, defaultVatTreatment: "FOO", paymentTermsDays: 45 })).toEqual({
      defaultExpenseAccountId: null,
      defaultRetentionRate: 15,
      defaultTaxDeductiblePct: null,
      defaultVatTreatment: null,
      paymentTermsDays: 45,
    });
  });
});
