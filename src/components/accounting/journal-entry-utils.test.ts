import { describe, expect, it } from "vitest";

import { calculateJournalTotals, canSubmitJournalEntry, updateJournalLineAmount } from "@/components/accounting/journal-entry-utils";

describe("journal entry form client validation", () => {
  it("calculates running debit, credit and difference totals in cents-safe decimals", () => {
    expect(calculateJournalTotals([
      { accountId: "cash", debit: "100.10", credit: "" },
      { accountId: "sales", debit: "", credit: "80.05" },
      { accountId: "tax", debit: "", credit: "20.05" },
    ])).toEqual({ totalDebit: 100.1, totalCredit: 100.1, difference: 0, isBalanced: true });
  });

  it("blocks submit until date, at least two valid lines and balanced totals are present", () => {
    expect(canSubmitJournalEntry({
      postedAt: "2026-05-09",
      lines: [
        { accountId: "cash", debit: "100", credit: "" },
        { accountId: "sales", debit: "", credit: "99" },
      ],
    })).toBe(false);

    expect(canSubmitJournalEntry({
      postedAt: "2026-05-09",
      lines: [
        { accountId: "cash", debit: "100", credit: "" },
        { accountId: "sales", debit: "", credit: "100" },
      ],
    })).toBe(true);
  });

  it("keeps debit and credit mutually exclusive when typing amounts", () => {
    const original = { accountId: "cash", debit: "15", credit: "" };

    expect(updateJournalLineAmount(original, "credit", "15")).toEqual({ accountId: "cash", debit: "", credit: "15" });
    expect(updateJournalLineAmount(original, "debit", "20")).toEqual({ accountId: "cash", debit: "20", credit: "" });
  });
});
