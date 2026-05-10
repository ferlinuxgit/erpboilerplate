import { describe, expect, it } from "vitest";

import { validateJournalLines } from "@/server/accounting/journal-validation";

describe("journal line balance validation", () => {
  it("accepts balanced multi-line entries and returns running totals", () => {
    const result = validateJournalLines([
      { accountId: "cash", debit: "100.25", credit: "" },
      { accountId: "sales", debit: "", credit: "80.10" },
      { accountId: "tax", debit: "", credit: "20.15" },
    ]);

    expect(result.totalDebit).toBe(100.25);
    expect(result.totalCredit).toBe(100.25);
    expect(result.difference).toBe(0);
    expect(result.lines).toEqual([
      { accountId: "cash", debit: "100.25", credit: "0.00" },
      { accountId: "sales", debit: "0.00", credit: "80.10" },
      { accountId: "tax", debit: "0.00", credit: "20.15" },
    ]);
  });

  it("rejects unbalanced entries", () => {
    expect(() => validateJournalLines([
      { accountId: "cash", debit: "100", credit: "" },
      { accountId: "sales", debit: "", credit: "99.99" },
    ])).toThrow("balanceado");
  });

  it("rejects unsafe lines with both sides, missing account, negative or non numeric amounts", () => {
    expect(() => validateJournalLines([
      { accountId: "cash", debit: "50", credit: "10" },
      { accountId: "sales", debit: "", credit: "40" },
    ])).toThrow("solo puede tener debe o haber");

    expect(() => validateJournalLines([
      { accountId: "", debit: "50", credit: "" },
      { accountId: "sales", debit: "", credit: "50" },
    ])).toThrow("Cuenta contable requerida");

    expect(() => validateJournalLines([
      { accountId: "cash", debit: "-50", credit: "" },
      { accountId: "sales", debit: "", credit: "-50" },
    ])).toThrow("no puede ser negativo");

    expect(() => validateJournalLines([
      { accountId: "cash", debit: "abc", credit: "" },
      { accountId: "sales", debit: "", credit: "0" },
    ])).toThrow("Importe invalido");
  });

  it("requires at least two active journal lines", () => {
    expect(() => validateJournalLines([
      { accountId: "cash", debit: "100", credit: "" },
    ])).toThrow("al menos dos lineas");

    expect(() => validateJournalLines([
      { accountId: "cash", debit: "100", credit: "" },
      { accountId: "sales", debit: "", credit: "" },
    ])).toThrow("Debe indicar un importe");
  });
});
