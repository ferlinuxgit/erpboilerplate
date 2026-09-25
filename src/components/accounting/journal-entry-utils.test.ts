import { describe, expect, it } from "vitest";

import { calculateJournalTotals, canSubmitJournalEntry, describeJournalEntryBlockers, normalizeJournalLinesForSubmit, updateJournalLineAmount } from "@/components/accounting/journal-entry-utils";

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

  it("acepta importes escritos a la española y los normaliza para la API", () => {
    const lines = [
      { accountId: "cash", debit: "1.234,56", credit: "" },
      { accountId: "sales", debit: "", credit: "1234.56" },
    ];
    expect(calculateJournalTotals(lines)).toMatchObject({ totalDebit: 1234.56, isBalanced: true });
    expect(normalizeJournalLinesForSubmit(lines)).toEqual([
      { accountId: "cash", debit: "1234.56", credit: "" },
      { accountId: "sales", debit: "", credit: "1234.56" },
    ]);
  });

  it("explica por qué no se puede guardar: fecha, cuenta sin elegir, importe y descuadre", () => {
    const reasons = describeJournalEntryBlockers({
      postedAt: "",
      lines: [
        { accountId: "", debit: "100", credit: "" },
        { accountId: "sales", debit: "", credit: "99" },
      ],
    });
    expect(reasons).toEqual([
      "Indica la fecha del asiento.",
      "Línea 1: elige la cuenta.",
      "Descuadre de 1,00 €: el debe supera al haber. Añade 1,00 € al haber.",
    ]);
    expect(describeJournalEntryBlockers({ postedAt: "2026-05-09", lines: [{ accountId: "a", debit: "-5", credit: "" }, { accountId: "b", debit: "", credit: "" }] })).toEqual([
      "Línea 1: el importe no es válido (usa por ejemplo 1.234,56).",
      "Línea 2: escribe un importe en el debe o en el haber.",
    ]);
  });
});
