import { describe, expect, it, vi } from "vitest";

// Funciones puras del motor de asientos; los asientos contra base de datos (subcuentas, conceptos,
// terceros, bancos, 555, prorrata…) están en `subaccounts.integration.test.ts` con PGlite.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  buildSalesInvoiceLines,
  buildSupplierInvoiceLines,
  normalizePostingLines,
  resolvePostingSettings,
  withLineDocument,
} from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";

function totals(lines: Array<{ debit: string; credit: string }>) {
  const cents = (value: string) => Math.round(Number(value) * 100);
  return {
    debit: lines.reduce((sum, line) => sum + cents(line.debit), 0),
    credit: lines.reduce((sum, line) => sum + cents(line.credit), 0),
  };
}

describe("resolvePostingSettings", () => {
  it("uses PGC accounts: 473 for withholdings suffered on sales, 4751 for withholdings practiced and 555 as suspense", () => {
    const settings = resolvePostingSettings(null, "ES");
    expect(settings.codes.withholdingReceivable).toBe("473");
    expect(settings.codes.withholdingPayable).toBe("4751");
    expect(settings.codes.suspense).toBe("555");
    expect(settings.prorrataPct).toBe(100);
  });

  it("clamps the prorrata percentage", () => {
    expect(resolvePostingSettings({ prorrataPct: "150" }, "ES").prorrataPct).toBe(100);
    expect(resolvePostingSettings({ prorrataPct: "40" }, "ES").prorrataPct).toBe(40);
  });
});

describe("normalizePostingLines", () => {
  it("rejects unbalanced automatic entries in cents", () => {
    expect(() => normalizePostingLines([
      { accountId: "a", debit: "15.11", credit: 0 },
      { accountId: "b", debit: 0, credit: "15.12" },
    ])).toThrow(AccountingRuleError);
  });

  it("flips negative amounts to the opposite side and drops zero lines", () => {
    expect(normalizePostingLines([
      { accountId: "a", debit: -10, credit: 0 },
      { accountId: "b", debit: 10, credit: 0 },
      { accountId: "c", debit: 0, credit: 0 },
    ])).toEqual([
      { accountId: "a", debit: "0.00", credit: "10.00" },
      { accountId: "b", debit: "10.00", credit: "0.00" },
    ]);
  });
});

describe("buildSupplierInvoiceLines", () => {
  const accounts = {
    purchase: "purchase-account",
    supplier: "supplier-account",
    vatInput: "vat-input-account",
    vatOutput: "vat-output-account",
    withholdingPayable: "withholding-payable-account",
  };

  it("balances the audit case 5.15 + 7.35 at 21% with 33% deductible VAT (was 15.11 vs 15.12)", () => {
    const lines = buildSupplierInvoiceLines({
      accounts,
      expenseLines: [
        { accountId: "expense-account", subtotal: 5.15, taxAmount: 1.08, taxDeductiblePct: 33 },
        { accountId: "expense-account", subtotal: 7.35, taxAmount: 1.54, taxDeductiblePct: 33 },
      ],
      totalAmount: 15.12,
      prorrataPct: 100,
      vatTreatment: "DOMESTIC",
    });
    const normalized = normalizePostingLines(lines);
    expect(normalized).toEqual([
      { accountId: "expense-account", debit: "14.25", credit: "0.00" },
      { accountId: "vat-input-account", debit: "0.87", credit: "0.00" },
      { accountId: "supplier-account", debit: "0.00", credit: "15.12" },
    ]);
    expect(totals(normalized).debit).toBe(totals(normalized).credit);
  });

  it("absorbs a rounding difference of the document total on the largest expense line", () => {
    const lines = normalizePostingLines(buildSupplierInvoiceLines({
      accounts,
      expenseLines: [
        { accountId: "small", subtotal: 1, taxAmount: 0.21 },
        { accountId: "large", subtotal: 10, taxAmount: 2.1 },
      ],
      totalAmount: 13.32,
      prorrataPct: 100,
      vatTreatment: "DOMESTIC",
    }));
    expect(lines.find((line) => line.accountId === "large")?.debit).toBe("10.01");
    expect(totals(lines).debit).toBe(totals(lines).credit);
  });

  it("rejects totals that differ from the lines beyond rounding tolerance", () => {
    expect(() => buildSupplierInvoiceLines({
      accounts,
      expenseLines: [{ subtotal: 100, taxAmount: 21 }],
      totalAmount: 130,
      prorrataPct: 100,
      vatTreatment: "DOMESTIC",
    })).toThrow("no coincide");
  });

  it("applies the prorrata: the non deductible VAT becomes expense", () => {
    const lines = normalizePostingLines(buildSupplierInvoiceLines({
      accounts,
      expenseLines: [{ accountId: "expense-account", subtotal: 100, taxAmount: 21, taxDeductiblePct: 100 }],
      totalAmount: 121,
      prorrataPct: 60,
      vatTreatment: "DOMESTIC",
    }));
    expect(lines).toEqual([
      { accountId: "expense-account", debit: "108.40", credit: "0.00" },
      { accountId: "vat-input-account", debit: "12.60", credit: "0.00" },
      { accountId: "supplier-account", debit: "0.00", credit: "121.00" },
    ]);
  });

  it("self-assesses VAT on intra-EU acquisitions (472 debit and 477 credit) and credits the supplier with the base only", () => {
    const lines = normalizePostingLines(buildSupplierInvoiceLines({
      accounts,
      expenseLines: [{ accountId: "expense-account", subtotal: 200, taxAmount: 0 }],
      totalAmount: 200,
      prorrataPct: 100,
      vatTreatment: "INTRA_EU",
    }));
    expect(lines).toEqual([
      { accountId: "expense-account", debit: "200.00", credit: "0.00" },
      { accountId: "vat-input-account", debit: "42.00", credit: "0.00" },
      { accountId: "supplier-account", debit: "0.00", credit: "200.00" },
      { accountId: "vat-output-account", debit: "0.00", credit: "42.00" },
    ]);
  });

  it("credits withholdings practiced to professionals to 4751", () => {
    const lines = normalizePostingLines(buildSupplierInvoiceLines({
      accounts,
      expenseLines: [{ accountId: "expense-account", subtotal: 100, taxAmount: 21, retentionAmount: 15 }],
      totalAmount: 106,
      prorrataPct: 100,
      vatTreatment: "DOMESTIC",
    }));
    expect(lines).toContainEqual({ accountId: "withholding-payable-account", debit: "0.00", credit: "15.00" });
    expect(lines).toContainEqual({ accountId: "supplier-account", debit: "0.00", credit: "106.00" });
  });
});

describe("resolvePostingSettings: cuenta de ventas por actividad", () => {
  it("empresas de servicios venden en 705 salvo que hayan configurado otra cuenta", () => {
    expect(resolvePostingSettings({ businessType: "services" }, "ES").codes.sales).toBe("705");
    expect(resolvePostingSettings({ businessType: "services", defaultSalesAccountCode: "700" }, "ES").codes.sales).toBe("705");
    expect(resolvePostingSettings({ businessType: "services", defaultSalesAccountCode: "7050001" }, "ES").codes.sales).toBe("7050001");
    expect(resolvePostingSettings({ businessType: "products" }, "ES").codes.sales).toBe("700");
    expect(resolvePostingSettings({ businessType: "both" }, "ES").codes.sales).toBe("700");
  });
});

describe("buildSalesInvoiceLines con varias cuentas de ventas", () => {
  it("reparte la base por cuenta y cuadra el redondeo en la de mayor importe", () => {
    const lines = normalizePostingLines(buildSalesInvoiceLines(
      { customer: "c", sales: "700", vatOutput: "477", withholdingReceivable: "c" },
      { subtotal: 100, taxAmount: 21, totalAmount: 121 },
      [{ accountId: "705", subtotal: 66.67 }, { accountId: "700", subtotal: 33.34 }],
    ));
    expect(lines).toEqual([
      { accountId: "c", debit: "121.00", credit: "0.00" },
      { accountId: "705", debit: "0.00", credit: "66.66" },
      { accountId: "700", debit: "0.00", credit: "33.34" },
      { accountId: "477", debit: "0.00", credit: "21.00" },
    ]);
  });
});

describe("withLineDocument", () => {
  it("pone concepto, tercero y documento en todas las líneas y el vencimiento solo en la del tercero", () => {
    const dueDate = new Date("2026-06-08");
    const lines = withLineDocument(
      [{ accountId: "430", debit: 10, credit: 0 }, { accountId: "700", debit: 0, credit: 10, concept: "Propio" }],
      { concept: "Fra. 1 · Pérez", partnerId: "p1", documentType: "invoice", documentNumber: "1", documentId: "i1", dueDate },
      ["430"],
    );
    expect(lines[0]).toMatchObject({ concept: "Fra. 1 · Pérez", partnerId: "p1", documentId: "i1", dueDate });
    expect(lines[1]).toMatchObject({ concept: "Propio", partnerId: "p1", dueDate: null });
    expect(normalizePostingLines(lines)[0]).toMatchObject({ concept: "Fra. 1 · Pérez", debit: "10.00" });
  });
});
