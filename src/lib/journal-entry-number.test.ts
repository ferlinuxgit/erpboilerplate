import { describe, expect, it } from "vitest";

import { formatJournalEntryNumber } from "@/lib/journal-entry-number";

describe("formatJournalEntryNumber", () => {
  it("formats a six-digit accounting sequence", () => {
    expect(formatJournalEntryNumber(1)).toBe("AS000001");
    expect(formatJournalEntryNumber(42)).toBe("AS000042");
  });

  it("normalizes invalid low and decimal values", () => {
    expect(formatJournalEntryNumber(0)).toBe("AS000001");
    expect(formatJournalEntryNumber(7.9)).toBe("AS000007");
  });
});
