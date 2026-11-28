import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildCreditNoteLines, buildSalesInvoiceLines, normalizePostingLines } from "@/server/accounting/auto-post";

const accounts = { customer: "430", sales: "700", vatOutput: "477", withholdingReceivable: "473", disbursement: "555" };

function byAccount(lines: Array<{ accountId: string; debit: string | number; credit: string | number }>) {
  return Object.fromEntries(lines.filter((line) => Number(line.debit) || Number(line.credit)).map((line) => [line.accountId, { debit: String(line.debit), credit: String(line.credit) }]));
}

describe("asiento de factura emitida con suplidos (art. 78.Tres.3.º LIVA)", () => {
  it("el suplido se abona en la cuenta puente (555) y no en ventas", () => {
    const lines = normalizePostingLines(buildSalesInvoiceLines(accounts, { subtotal: 1000, taxAmount: 210, retentionAmount: 150, disbursementAmount: 60.5, totalAmount: 1120.5 }));
    expect(byAccount(lines)).toEqual({
      430: { debit: "1120.50", credit: "0.00" },
      473: { debit: "150.00", credit: "0.00" },
      700: { debit: "0.00", credit: "1000.00" },
      477: { debit: "0.00", credit: "210.00" },
      555: { debit: "0.00", credit: "60.50" },
    });
  });

  it("sin suplidos el asiento es el de siempre", () => {
    const withAccount = normalizePostingLines(buildSalesInvoiceLines(accounts, { subtotal: 100, taxAmount: 21, totalAmount: 121 }));
    const { disbursement: _unused, ...legacyAccounts } = accounts;
    void _unused;
    const legacy = normalizePostingLines(buildSalesInvoiceLines(legacyAccounts, { subtotal: 100, taxAmount: 21, totalAmount: 121 }));
    expect(byAccount(withAccount)).toEqual(byAccount(legacy));
  });

  it("la rectificativa que abona el suplido deshace la 555", () => {
    const lines = normalizePostingLines(buildCreditNoteLines(accounts, { subtotal: -1000, taxAmount: -210, disbursementAmount: -60.5, totalAmount: -1270.5 }));
    expect(byAccount(lines)).toEqual({
      430: { debit: "0.00", credit: "1270.50" },
      700: { debit: "1000.00", credit: "0.00" },
      477: { debit: "210.00", credit: "0.00" },
      555: { debit: "60.50", credit: "0.00" },
    });
  });
});

describe("asiento de anticipos (art. 75.Dos LIVA; 438 del PGC)", () => {
  it("la factura de anticipo abona la 438", () => {
    const lines = normalizePostingLines(buildSalesInvoiceLines(accounts, { subtotal: 300, taxAmount: 63, totalAmount: 363 }, [{ accountId: "438", subtotal: 300 }]));
    expect(byAccount(lines)).toEqual({
      430: { debit: "363.00", credit: "0.00" },
      438: { debit: "0.00", credit: "300.00" },
      477: { debit: "0.00", credit: "63.00" },
    });
  });

  it("la factura final carga la 438 por el anticipo descontado", () => {
    const lines = normalizePostingLines(buildSalesInvoiceLines(accounts, { subtotal: 700, taxAmount: 147, totalAmount: 847 }, [
      { accountId: "700", subtotal: 1000 },
      { accountId: "438", subtotal: -300 },
    ]));
    expect(byAccount(lines)).toEqual({
      430: { debit: "847.00", credit: "0.00" },
      438: { debit: "300.00", credit: "0.00" },
      700: { debit: "0.00", credit: "1000.00" },
      477: { debit: "0.00", credit: "147.00" },
    });
  });

  it("la rectificativa total de la final devuelve la 438 al haber", () => {
    const lines = normalizePostingLines(buildCreditNoteLines(accounts, { subtotal: -700, taxAmount: -147, totalAmount: -847 }, [
      { accountId: "700", subtotal: -1000 },
      { accountId: "438", subtotal: 300 },
    ]));
    expect(byAccount(lines)).toEqual({
      430: { debit: "0.00", credit: "847.00" },
      438: { debit: "0.00", credit: "300.00" },
      700: { debit: "1000.00", credit: "0.00" },
      477: { debit: "147.00", credit: "0.00" },
    });
  });
});
