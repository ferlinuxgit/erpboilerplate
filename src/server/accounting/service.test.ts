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
const lockMocks = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  assertFiscalPeriodOpen: vi.fn(async (_companyId: string, _date: Date, _client?: unknown): Promise<void> => undefined),
}));
vi.mock("@/server/fiscal/locks", () => lockMocks);

import { AccountingRuleError } from "@/server/accounting/errors";
import { assertJournalEntryEditable, createJournalEntry, updateJournalEntry } from "@/server/accounting/service";

function chain(result: unknown) {
  const value: Record<string, unknown> = {};
  for (const method of ["from", "where", "for", "limit", "orderBy"]) value[method] = vi.fn(() => value);
  value.then = (resolve: (input: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return value;
}

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
    })).rejects.toThrow("descuadrado");

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
    })).rejects.toThrow("descuadrado");

    expect(dbMocks.transaction).not.toHaveBeenCalled();
  });
});

describe("journal entry edit rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forbids editing automatic, reversed and reversal entries", () => {
    expect(() => assertJournalEntryEditable({ isAutomatic: true, reversedAt: null, reversesEntryId: null })).toThrow("automáticos");
    expect(() => assertJournalEntryEditable({ isAutomatic: false, reversedAt: new Date(), reversesEntryId: null })).toThrow("revertido");
    expect(() => assertJournalEntryEditable({ isAutomatic: false, reversedAt: null, reversesEntryId: "x" })).toThrow("reversión");
    expect(() => assertJournalEntryEditable({ isAutomatic: false, reversedAt: null, reversesEntryId: null })).not.toThrow();
  });

  it("validates the ORIGINAL date against locked periods, not only the new one", async () => {
    const originalDate = new Date("2026-02-10");
    dbMocks.select.mockReturnValueOnce(chain([{ id: "cash" }, { id: "sales" }]));
    const tx = { select: vi.fn(() => chain([{ postedAt: originalDate, reference: "x", isAutomatic: false, reversedAt: null, reversesEntryId: null }])) };
    dbMocks.transaction.mockImplementationOnce(async (callback: (client: unknown) => unknown) => callback(tx));
    lockMocks.assertFiscalPeriodOpen.mockImplementation(async (_companyId: string, date: Date) => {
      if (date.getTime() === originalDate.getTime()) throw new AccountingRuleError(409, "FISCAL_PERIOD_LOCKED", "El periodo fiscal 2026-Q1 del modelo 303 ya está presentado y bloqueado.");
    });

    await expect(updateJournalEntry("company-1", "tenant-1", "user-1", "entry-1", {
      postedAt: new Date("2026-05-09"),
      lines: [
        { accountId: "cash", debit: "10.00", credit: "" },
        { accountId: "sales", debit: "", credit: "10.00" },
      ],
    })).rejects.toMatchObject({ status: 409 });
    expect(lockMocks.assertFiscalPeriodOpen).toHaveBeenCalledWith("company-1", originalDate, tx);
  });
});

