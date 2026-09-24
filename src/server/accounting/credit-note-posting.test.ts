import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildCreditNoteLines, buildSalesInvoiceLines, normalizePostingLines } from "@/server/accounting/auto-post";

const accounts = { customer: "430", sales: "700", vatOutput: "477", withholdingReceivable: "473" };

function byAccount(lines: Array<{ accountId: string; debit: string | number; credit: string | number }>) {
  return Object.fromEntries(lines.filter((line) => Number(line.debit) || Number(line.credit)).map((line) => [line.accountId, { debit: String(line.debit), credit: String(line.credit) }]));
}

describe("buildCreditNoteLines", () => {
  it("una rectificativa negativa es el asiento inverso de la venta y cuadra", () => {
    const invoiceLines = normalizePostingLines(buildSalesInvoiceLines(accounts, { subtotal: 320, taxAmount: 54, totalAmount: 374 }));
    const creditLines = normalizePostingLines(buildCreditNoteLines(accounts, { subtotal: -320, taxAmount: -54, totalAmount: -374 }));

    expect(byAccount(creditLines)).toEqual({
      430: { debit: "0.00", credit: "374.00" },
      700: { debit: "320.00", credit: "0.00" },
      477: { debit: "54.00", credit: "0.00" },
    });
    const invoice = byAccount(invoiceLines);
    for (const [account, amounts] of Object.entries(byAccount(creditLines))) {
      expect(amounts.debit).toBe(invoice[account]?.credit);
      expect(amounts.credit).toBe(invoice[account]?.debit);
    }
  });

  it("incluye la retención (473) invertida", () => {
    const lines = normalizePostingLines(buildCreditNoteLines(accounts, { subtotal: -1000, taxAmount: -210, retentionAmount: -150, totalAmount: -1060 }));
    expect(byAccount(lines)).toEqual({
      430: { debit: "0.00", credit: "1060.00" },
      473: { debit: "0.00", credit: "150.00" },
      700: { debit: "1000.00", credit: "0.00" },
      477: { debit: "210.00", credit: "0.00" },
    });
  });

  it("una rectificación al alza se contabiliza como venta", () => {
    const lines = normalizePostingLines(buildCreditNoteLines(accounts, { subtotal: 100, taxAmount: 21, totalAmount: 121 }));
    expect(byAccount(lines)["430"]).toEqual({ debit: "121.00", credit: "0.00" });
  });

  it("rechaza importes incoherentes (no cuadran)", () => {
    expect(() => buildCreditNoteLines(accounts, { subtotal: -100, taxAmount: -21, totalAmount: -120 })).toThrow(/no cuadra/);
  });
});
