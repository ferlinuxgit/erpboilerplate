import { beforeEach, describe, expect, it, vi } from "vitest";

import { accountChart, company, companySettings, partner, supplierInvoice, supplierInvoiceLine, supplierInvoicePayment } from "@/db/schema";

const mocks = vi.hoisted(() => {
  const state = {
    selectResults: new Map<unknown, unknown[]>(),
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    updates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  };

  /** Cadena Drizzle mínima: cualquier método encadenable devuelve la cadena y `await` resuelve el resultado. */
  function chain(resolve: () => unknown) {
    const target: Record<string, unknown> = {};
    for (const method of ["where", "limit", "for", "orderBy", "innerJoin", "leftJoin", "groupBy", "onConflictDoNothing"]) {
      target[method] = () => target;
    }
    target.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve().then(resolve).then(onFulfilled, onRejected);
    return target;
  }

  let header: Record<string, unknown> = {};
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => ({ from: (table: unknown) => chain(() => state.selectResults.get(table) ?? []) })),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        const row = { id: "supplier-invoice-1", number: "FP-2026-0001", ...values };
        if (!Array.isArray(values) && "supplierPartnerId" in values) header = row;
        const inserted = chain(() => undefined);
        inserted.returning = () => chain(() => [row]);
        return inserted;
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push({ table, values });
        const updated = chain(() => undefined);
        updated.returning = () => chain(() => [{ ...header, ...values }]);
        return updated;
      },
    })),
  };

  return {
    state,
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    postSupplierInvoice: vi.fn(),
    recordAudit: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: vi.fn(async () => "FP-2026-0001") }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: vi.fn() }));
vi.mock("@/server/partners/numbers", () => ({ reservePartnerNumber: vi.fn(async () => "P-0001") }));
vi.mock("@/server/accounting/auto-post", () => ({ postSupplierInvoice: mocks.postSupplierInvoice, reverseAutomaticEntries: vi.fn() }));

import {
  assessExpenseDuplicate,
  computeSupplierInvoiceAmounts,
  createExpenseInvoice,
  refreshSupplierInvoicePaymentStatus,
  type CreateExpenseInvoiceInput,
} from "@/server/supplier-invoices/service";

function supplierRow(countryCode: string) {
  return [{ id: "supplier-1", name: "Proveedor", taxId: "X123", countryCode, type: "SUPPLIER" }];
}

function baseInput(overrides: Partial<CreateExpenseInvoiceInput> = {}): CreateExpenseInvoiceInput {
  return {
    tenantId: "tenant-1",
    companyId: "company-1",
    fiscalYearId: "fy-1",
    actorUserId: "user-1",
    supplierPartnerId: "supplier-1",
    issueDate: new Date("2026-05-10T12:00:00.000Z"),
    lines: [{ description: "Servicio", quantity: 1, unitPrice: 1_000, taxRate: 21 }],
    ...overrides,
  };
}

function insertedHeader() {
  return mocks.state.inserts.find((entry) => entry.table === supplierInvoice)?.values as Record<string, unknown>;
}

function insertedLines() {
  return mocks.state.inserts.find((entry) => entry.table === supplierInvoiceLine)?.values as Array<Record<string, string>>;
}

function totalsUpdate() {
  return mocks.state.updates.find((entry) => entry.table === supplierInvoice && "totalAmount" in entry.values)?.values;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.inserts.length = 0;
  mocks.state.updates.length = 0;
  mocks.state.selectResults = new Map<unknown, unknown[]>([
    [partner, supplierRow("ES")],
    [companySettings, []],
    [accountChart, [{ id: "account-600" }]],
    [company, [{ baseCurrencyCode: "EUR" }]],
  ]);
});

describe("computeSupplierInvoiceAmounts", () => {
  it("uses the tax engine: per-line base, VAT per rate bucket", () => {
    const lines = [0, 1, 2].map(() => ({ description: "Tornillo", quantity: 1, unitPrice: 0.35, taxRate: 21 }));
    const amounts = computeSupplierInvoiceAmounts(lines, "DOMESTIC");

    expect(amounts.lines.map((line) => line.taxAmount)).toEqual([0.07, 0.07, 0.07]);
    expect(amounts).toMatchObject({ subtotalAmount: 1.05, taxAmount: 0.22, retentionAmount: 0, totalAmount: 1.27 });
  });

  it("excludes self-assessed VAT from the payable total", () => {
    const amounts = computeSupplierInvoiceAmounts(
      [{ description: "Licencia", quantity: 2, unitPrice: 500, taxRate: 21, retentionRate: 15 }],
      "INTRA_EU",
    );

    expect(amounts).toMatchObject({ subtotalAmount: 1_000, taxAmount: 210, retentionAmount: 150, totalAmount: 850 });
    expect(amounts.lines[0]).toMatchObject({ subtotalAmount: 1_000, taxAmount: 210, retentionAmount: 150, lineTotal: 850 });
  });

  it("self-assesses at the general rate when the line has no VAT rate", () => {
    const amounts = computeSupplierInvoiceAmounts([{ description: "Obra", quantity: 1, unitPrice: 200, taxRate: 0 }], "REVERSE_CHARGE");

    expect(amounts.lines[0]).toMatchObject({ taxAmount: 0, lineTotal: 200 });
    expect(amounts).toMatchObject({ subtotalAmount: 200, taxAmount: 42, totalAmount: 200 });
  });

  it("keeps VAT in the payable total for imports and domestic purchases", () => {
    const line = { description: "Material", quantity: 1, unitPrice: 100, taxRate: 21 };
    expect(computeSupplierInvoiceAmounts([line], "DOMESTIC").totalAmount).toBe(121);
    expect(computeSupplierInvoiceAmounts([line], "IMPORT").totalAmount).toBe(121);
  });

  it("produces a balanced self-assessed accounting entry", async () => {
    const { buildSupplierInvoiceLines } = await vi.importActual<typeof import("@/server/accounting/auto-post")>("@/server/accounting/auto-post");
    const amounts = computeSupplierInvoiceAmounts(
      [
        { description: "A", quantity: 3, unitPrice: 0.35, taxRate: 21, retentionRate: 15 },
        { description: "B", quantity: 1, unitPrice: 99.99, taxRate: 10, taxDeductiblePct: 50 },
      ],
      "INTRA_EU",
    );
    const lines = buildSupplierInvoiceLines({
      accounts: { purchase: "600", supplier: "400", vatInput: "472", vatOutput: "477", withholdingPayable: "4751" },
      expenseLines: amounts.lines.map((line) => ({ accountId: "600", subtotal: line.subtotalAmount, taxAmount: line.taxAmount, taxDeductiblePct: line.taxDeductiblePct, retentionAmount: line.retentionAmount })),
      totalAmount: amounts.totalAmount,
      prorrataPct: 100,
      vatTreatment: "INTRA_EU",
    });
    const debit = lines.reduce((sum, line) => sum + Math.round(Number(line.debit) * 100), 0);
    const credit = lines.reduce((sum, line) => sum + Math.round(Number(line.credit) * 100), 0);

    expect(debit).toBe(credit);
    expect(Number(lines.find((line) => line.accountId === "400")?.credit)).toBe(amounts.totalAmount);
    expect(Number(lines.find((line) => line.accountId === "477")?.credit)).toBe(amounts.taxAmount);
  });
});

describe("createExpenseInvoice vatTreatment", () => {
  it("resolves and persists the treatment from the supplier country when not provided", async () => {
    mocks.state.selectResults.set(partner, supplierRow("DE"));

    await createExpenseInvoice(baseInput());

    expect(insertedHeader()).toMatchObject({ vatTreatment: "INTRA_EU" });
    expect(totalsUpdate()).toMatchObject({ subtotalAmount: "1000.00", taxAmount: "210.00", retentionAmount: "0.00", totalAmount: "1000.00", paymentStatus: "PENDING" });
    expect(insertedLines()[0]).toMatchObject({ subtotalAmount: "1000.00", taxAmount: "210.00", lineTotal: "1000.00" });
    expect(mocks.postSupplierInvoice).toHaveBeenCalledWith(expect.objectContaining({
      vatTreatment: "INTRA_EU",
      subtotal: 1_000,
      taxAmount: 210,
      totalAmount: 1_000,
    }));
  });

  it("persists an explicit treatment over the country default", async () => {
    await createExpenseInvoice(baseInput({
      vatTreatment: "REVERSE_CHARGE",
      lines: [{ description: "Obra", quantity: 1, unitPrice: 1_000, taxRate: 21, retentionRate: 15 }],
    }));

    expect(insertedHeader()).toMatchObject({ vatTreatment: "REVERSE_CHARGE" });
    expect(totalsUpdate()).toMatchObject({ taxAmount: "210.00", retentionAmount: "150.00", totalAmount: "850.00" });
    expect(mocks.postSupplierInvoice).toHaveBeenCalledWith(expect.objectContaining({ vatTreatment: "REVERSE_CHARGE", totalAmount: 850 }));
  });

  it("stores DOMESTIC for Spanish suppliers and keeps VAT in the total", async () => {
    await createExpenseInvoice(baseInput());

    expect(insertedHeader()).toMatchObject({ vatTreatment: "DOMESTIC" });
    expect(totalsUpdate()).toMatchObject({ taxAmount: "210.00", totalAmount: "1210.00" });
  });
});

describe("refreshSupplierInvoicePaymentStatus", () => {
  it("marks a self-assessed invoice as paid once the payable total (base − retention) is paid", async () => {
    mocks.state.selectResults.set(supplierInvoice, [{ id: "supplier-invoice-1", totalAmount: "1000.00", dueDate: null }]);
    mocks.state.selectResults.set(supplierInvoicePayment, [{ paidAmount: "1000.00" }]);

    await refreshSupplierInvoicePaymentStatus("company-1", "supplier-invoice-1", mocks.tx as never);

    expect(mocks.state.updates.at(-1)?.values).toMatchObject({ paymentStatus: "PAID" });
  });
});

describe("createExpenseInvoice supplier defaults", () => {
  it("computes the due date from the supplier payment terms and uses its usual VAT treatment", async () => {
    mocks.state.selectResults.set(partner, [{ ...supplierRow("ES")[0], paymentTermsDays: 30, defaultVatTreatment: "REVERSE_CHARGE", defaultExpenseAccountId: null }]);

    await createExpenseInvoice(baseInput());

    expect(insertedHeader()).toMatchObject({ vatTreatment: "REVERSE_CHARGE" });
    expect((insertedHeader().dueDate as Date).toISOString()).toBe("2026-06-09T12:00:00.000Z");
  });

  it("keeps an explicit due date and treatment over the supplier defaults", async () => {
    mocks.state.selectResults.set(partner, [{ ...supplierRow("ES")[0], paymentTermsDays: 30, defaultVatTreatment: "REVERSE_CHARGE" }]);
    const dueDate = new Date("2026-05-20T12:00:00.000Z");

    await createExpenseInvoice(baseInput({ dueDate, vatTreatment: "DOMESTIC" }));

    expect(insertedHeader()).toMatchObject({ vatTreatment: "DOMESTIC", dueDate });
  });

  it("leaves the due date empty when the supplier has no payment terms", async () => {
    await createExpenseInvoice(baseInput());

    expect(insertedHeader().dueDate).toBeNull();
  });
});

describe("assessExpenseDuplicate", () => {
  const input = {
    companyId: "company-1",
    supplierPartnerId: "supplier-1",
    issueDate: new Date("2026-05-10T12:00:00.000Z"),
    totalAmount: 121,
  };

  it("is exact when the same supplier already has that invoice number", async () => {
    mocks.state.selectResults.set(supplierInvoice, [{ invoiceId: "si-1", number: "FP-1" }]);

    const result = await assessExpenseDuplicate({ ...input, supplierDocumentNumber: "f-001" }, mocks.tx as never);

    expect(result.level).toBe("exact");
    expect(result.matches).toEqual([{ invoiceId: "si-1", number: "FP-1", reason: "supplier-number" }]);
  });

  it("is only possible when the same supplier has an invoice with the same date and amount", async () => {
    mocks.state.selectResults.set(supplierInvoice, [{ invoiceId: "si-2", number: "FP-2" }]);

    const result = await assessExpenseDuplicate(input, mocks.tx as never);

    expect(result).toEqual({ level: "possible", matches: [{ invoiceId: "si-2", number: "FP-2", reason: "date-total" }] });
  });

  it("finds nothing for a new invoice", async () => {
    mocks.state.selectResults.set(supplierInvoice, []);

    expect(await assessExpenseDuplicate({ ...input, supplierDocumentNumber: "F-9" }, mocks.tx as never)).toEqual({ level: "none", matches: [] });
  });
});
