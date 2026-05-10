import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMocks }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

import { createJournalEntry, updateJournalEntry } from "@/server/accounting/service";

describe("accounting journal service validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unbalanced journal entries on create before opening a database transaction", async () => {
    await expect(createJournalEntry("company-1", "tenant-1", "user-1", {
      postedAt: new Date("2026-05-09"),
      reference: "INV-1",
      lines: [
        { accountId: "cash", debit: "100.00", credit: "" },
        { accountId: "sales", debit: "", credit: "99.99" },
      ],
    })).rejects.toThrow("balanceado");

    expect(dbMocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects unbalanced journal entries on edit before opening a database transaction", async () => {
    await expect(updateJournalEntry("company-1", "tenant-1", "user-1", "entry-1", {
      postedAt: new Date("2026-05-09"),
      reference: "INV-1",
      lines: [
        { accountId: "cash", debit: "50.00", credit: "" },
        { accountId: "sales", debit: "", credit: "40.00" },
      ],
    })).rejects.toThrow("balanceado");

    expect(dbMocks.transaction).not.toHaveBeenCalled();
  });
});
