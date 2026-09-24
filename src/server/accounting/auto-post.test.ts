import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  /** Cliente Drizzle simulado: cada `select` consume la siguiente respuesta de la cola. */
  const createDbClientMock = (selectResults: unknown[][] = []) => {
    const insertedValues: unknown[] = [];
    const makeChain = () => {
      const chain: Record<string, unknown> = {};
      for (const method of ["from", "where", "limit", "innerJoin", "leftJoin", "orderBy", "groupBy", "for"]) {
        chain[method] = vi.fn(() => chain);
      }
      chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);
      return chain;
    };
    const client = {
      selectResults,
      insertedValues,
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => {
          insertedValues.push(values);
          const result = Promise.resolve(undefined);
          return Object.assign(result, { returning: vi.fn(async () => [{ id: "journal-entry-1" }]) });
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    };
    return client;
  };

  return {
    createDbClientMock,
    db: createDbClientMock(),
    ensureDefaultJournal: vi.fn(async () => ({ id: "journal-1" })),
    reserveJournalEntryNumber: vi.fn(async () => "AS000001"),
    recordAudit: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/accounting/service", () => ({ ensureDefaultJournal: mocks.ensureDefaultJournal }));
vi.mock("@/server/accounting/numbers", () => ({ reserveJournalEntryNumber: mocks.reserveJournalEntryNumber }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));

import {
  buildSupplierInvoiceLines,
  normalizePostingLines,
  postBankTransaction,
  postCustomerPayment,
  postSalesInvoice,
  postSupplierInvoice,
  resolvePostingSettings,
} from "@/server/accounting/auto-post";
import { AccountingRuleError } from "@/server/accounting/errors";

const accountRows = [
  { id: "customer-account", code: "4300" },
  { id: "supplier-account", code: "4100" },
  { id: "sales-account", code: "700" },
  { id: "purchase-account", code: "600" },
  { id: "bank-account", code: "572" },
  { id: "vat-output-account", code: "477" },
  { id: "vat-input-account", code: "472" },
  { id: "withholding-payable-account", code: "4751" },
  { id: "withholding-receivable-account", code: "473" },
  { id: "suspense-account", code: "555" },
];

const baseInput = { tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", postedAt: new Date("2026-05-09") };

function journalLinesOf(tx: ReturnType<typeof mocks.createDbClientMock>) {
  // insertedValues[0] = cabecera del asiento, [1] = líneas.
  return tx.insertedValues[1] as Array<{ accountId: string; debit: string; credit: string }>;
}

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

describe("accounting auto posting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts sales withholdings to 473 (Hacienda Pública, retenciones y pagos a cuenta)", async () => {
    const tx = mocks.createDbClientMock([[], [{ countryCode: "ES" }], accountRows]);

    await postSalesInvoice({
      ...baseInput,
      invoiceId: "invoice-1",
      reference: "Factura FAC-1",
      subtotal: 100,
      taxAmount: 21,
      retentionAmount: 15,
      totalAmount: 106,
      dbClient: tx as never,
    });

    expect(journalLinesOf(tx)).toEqual([
      expect.objectContaining({ accountId: "customer-account", debit: "106.00", credit: "0.00" }),
      expect.objectContaining({ accountId: "withholding-receivable-account", debit: "15.00", credit: "0.00" }),
      expect.objectContaining({ accountId: "sales-account", debit: "0.00", credit: "100.00" }),
      expect.objectContaining({ accountId: "vat-output-account", debit: "0.00", credit: "21.00" }),
    ]);
  });

  it("uses the supplied transaction client for every database write", async () => {
    const tx = mocks.createDbClientMock([[], [{ countryCode: "ES" }], accountRows]);

    await postSalesInvoice({
      ...baseInput,
      invoiceId: "invoice-1",
      reference: "Factura FAC-1",
      subtotal: 100,
      taxAmount: 21,
      totalAmount: 121,
      dbClient: tx as never,
    });

    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(mocks.ensureDefaultJournal).toHaveBeenCalledWith("company-1", tx);
    expect(mocks.reserveJournalEntryNumber).toHaveBeenCalledWith(tx, "company-1");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "accounting.autopost.salesInvoice", entityName: "invoice", entityId: "invoice-1" }),
      tx,
    );
  });

  it("fails with a clear message when a required account is missing", async () => {
    const tx = mocks.createDbClientMock([[], [{ countryCode: "ES" }], accountRows.filter((row) => row.code !== "477")]);
    await expect(postSalesInvoice({
      ...baseInput,
      invoiceId: "invoice-1",
      reference: "Factura FAC-1",
      subtotal: 100,
      taxAmount: 21,
      totalAmount: 121,
      dbClient: tx as never,
    })).rejects.toThrow("477");
  });

  it("posts supplier invoices applying the company prorrata from settings", async () => {
    const tx = mocks.createDbClientMock([[{ prorrataPct: "50" }], [{ countryCode: "ES" }], accountRows]);

    await postSupplierInvoice({
      ...baseInput,
      supplierInvoiceId: "supplier-invoice-1",
      reference: "Gasto luz",
      subtotal: 100,
      taxAmount: 21,
      retentionAmount: 0,
      totalAmount: 121,
      vatTreatment: "DOMESTIC",
      expenseLines: [{ accountId: "expense-account", subtotal: 100, taxAmount: 21, taxDeductiblePct: 100 }],
      dbClient: tx as never,
    });

    expect(journalLinesOf(tx)).toEqual([
      expect.objectContaining({ accountId: "expense-account", debit: "110.50" }),
      expect.objectContaining({ accountId: "vat-input-account", debit: "10.50" }),
      expect.objectContaining({ accountId: "supplier-account", credit: "121.00" }),
    ]);
  });

  it("posts customer payments to the ledger account of the payment method's bank", async () => {
    const tx = mocks.createDbClientMock([
      [],
      [{ countryCode: "ES" }],
      accountRows,
      [{ bankAccountId: "bank-1" }],
      [{ accountId: "bank-ledger-5720001" }],
    ]);

    await postCustomerPayment({ ...baseInput, paymentId: "payment-1", reference: "Cobro", amount: 50, paymentMethodId: "method-1", dbClient: tx as never });

    expect(journalLinesOf(tx)).toEqual([
      expect.objectContaining({ accountId: "bank-ledger-5720001", debit: "50.00" }),
      expect.objectContaining({ accountId: "customer-account", credit: "50.00" }),
    ]);
  });

  it("falls back to the default bank account when the payment method has no linked bank", async () => {
    const tx = mocks.createDbClientMock([[], [{ countryCode: "ES" }], accountRows, [{ bankAccountId: null }]]);

    await postCustomerPayment({ ...baseInput, paymentId: "payment-1", reference: "Cobro", amount: 50, paymentMethodId: "cash", dbClient: tx as never });

    expect(journalLinesOf(tx)[0]).toEqual(expect.objectContaining({ accountId: "bank-account", debit: "50.00" }));
  });

  it("posts unapplied bank movements against 555 instead of customers or suppliers", async () => {
    const deposit = mocks.createDbClientMock([[], [{ countryCode: "ES" }], accountRows, []]);
    await postBankTransaction({ ...baseInput, bankTransactionId: "bt-1", bankAccountId: "bank-1", reference: "Ingreso", amount: 80, dbClient: deposit as never });
    expect(journalLinesOf(deposit)).toEqual([
      expect.objectContaining({ accountId: "bank-account", debit: "80.00" }),
      expect.objectContaining({ accountId: "suspense-account", credit: "80.00" }),
    ]);

    const charge = mocks.createDbClientMock([[], [{ countryCode: "ES" }], accountRows, [{ accountId: "bank-ledger-5720001" }]]);
    await postBankTransaction({ ...baseInput, bankTransactionId: "bt-2", bankAccountId: "bank-1", reference: "Comisión", amount: -3.5, dbClient: charge as never });
    expect(journalLinesOf(charge)).toEqual([
      expect.objectContaining({ accountId: "suspense-account", debit: "3.50" }),
      expect.objectContaining({ accountId: "bank-ledger-5720001", credit: "3.50" }),
    ]);
  });
});
