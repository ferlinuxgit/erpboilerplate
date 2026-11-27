import { beforeEach, describe, expect, it, vi } from "vitest";

import { accountChart, company, companySettings, journalEntry, partner, supplierCreditApplication, supplierInvoice, supplierInvoiceLine, supplierInvoicePayment, supplierPayment } from "@/db/schema";
import { AccountingRuleError } from "@/server/accounting/errors";

const mocks = vi.hoisted(() => {
  const state = {
    selectResults: new Map<unknown, unknown[]>(),
    /** Resultados consumidos en orden por tabla antes de caer en `selectResults`. */
    selectQueues: new Map<unknown, unknown[][]>(),
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
    select: vi.fn(() => ({ from: (table: unknown) => chain(() => state.selectQueues.get(table)?.shift() ?? state.selectResults.get(table) ?? []) })),
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
    assertFiscalPeriodOpen: vi.fn(),
    resolveOpenPostingDate: vi.fn(async (_companyId: string, preferred: Date) => preferred),
    recordAudit: vi.fn(),
    applySupplierCreditInTransaction: vi.fn(async () => null),
    releaseSupplierCreditApplications: vi.fn(async () => 0),
  };
});

vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/server/documents/series", () => ({ reserveSeriesNumber: vi.fn(async () => "FP-2026-0001") }));
vi.mock("@/server/fiscal/locks", () => ({ assertFiscalPeriodOpen: mocks.assertFiscalPeriodOpen, resolveOpenPostingDate: mocks.resolveOpenPostingDate }));
vi.mock("@/server/partners/numbers", () => ({ reservePartnerNumber: vi.fn(async () => "P-0001") }));
vi.mock("@/server/accounting/auto-post", () => ({ postSupplierInvoice: mocks.postSupplierInvoice, reverseAutomaticEntries: vi.fn() }));
vi.mock("@/server/supplier-invoices/credits", () => ({
  applySupplierCreditInTransaction: mocks.applySupplierCreditInTransaction,
  releaseSupplierCreditApplications: mocks.releaseSupplierCreditApplications,
  listSupplierCreditApplications: vi.fn(async () => ({ asCredit: [], asInvoice: [] })),
}));

import {
  assessExpenseDuplicate,
  buildPostingExpenseLines,
  computeSupplierInvoiceAmounts,
  createExpenseInvoice,
  deleteVoidedExpenseInvoice,
  isPurchaseLineAccount,
  refreshSupplierInvoicePaymentStatus,
  voidExpenseInvoice,
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
  mocks.state.selectQueues = new Map<unknown, unknown[][]>();
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
    mocks.state.selectResults.set(supplierInvoicePayment, [{ id: "supplier-invoice-1", amount: "1000.00" }]);

    await refreshSupplierInvoicePaymentStatus("company-1", "supplier-invoice-1", mocks.tx as never);

    expect(mocks.state.updates.at(-1)?.values).toMatchObject({ paymentStatus: "PAID" });
  });

  it("cuenta los abonos compensados: una factura cubierta por pago + abono queda pagada", async () => {
    mocks.state.selectResults.set(supplierInvoice, [{ id: "supplier-invoice-1", totalAmount: "1000.00", dueDate: null }]);
    mocks.state.selectResults.set(supplierInvoicePayment, [{ id: "supplier-invoice-1", amount: "600.00" }]);
    mocks.state.selectResults.set(supplierCreditApplication, [{ id: "supplier-invoice-1", amount: "400.00" }]);

    await refreshSupplierInvoicePaymentStatus("company-1", "supplier-invoice-1", mocks.tx as never);

    expect(mocks.state.updates.at(-1)?.values).toMatchObject({ paymentStatus: "PAID" });
    mocks.state.selectResults.delete(supplierCreditApplication);
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

describe("purchase line accounts", () => {
  it("accepts expense (6) and fixed-asset (2) accounts and rejects banks or customers in Spain", () => {
    expect(isPurchaseLineAccount({ code: "62800000", type: "EXPENSE" }, "ES")).toBe(true);
    expect(isPurchaseLineAccount({ code: "21700000", type: "ASSET" }, "ES")).toBe(true);
    expect(isPurchaseLineAccount({ code: "57200000", type: "ASSET" }, "ES")).toBe(false);
    expect(isPurchaseLineAccount({ code: "43000000", type: "ASSET" }, "ES")).toBe(false);
    // Otros países: plantilla genérica con la misma numeración por grupos.
    expect(isPurchaseLineAccount({ code: "57200000", type: "ASSET" }, "US")).toBe(false);
    expect(isPurchaseLineAccount({ code: "62800000", type: "EXPENSE" }, "FR")).toBe(true);
  });

  it("refuses to post an expense line to a bank account", async () => {
    mocks.state.selectResults.set(accountChart, [{ id: "acc-572", code: "57200000", name: "Bancos", type: "ASSET" }]);
    mocks.state.selectResults.set(company, [{ baseCurrencyCode: "EUR", countryCode: "ES" }]);

    await expect(createExpenseInvoice(baseInput({
      lines: [{ description: "Servicio", quantity: 1, unitPrice: 100, taxRate: 21, expenseAccountId: "acc-572" }],
    }))).rejects.toThrow(/no es de gasto ni de inmovilizado/);
    expect(mocks.postSupplierInvoice).not.toHaveBeenCalled();
  });
});

describe("supplier resolution by name", () => {
  it("never overwrites the tax id of an existing supplier with the same name: creates a new one", async () => {
    // 1) Sin coincidencia por CIF. 2) Coincide el nombre, pero ese proveedor ya tiene otro CIF.
    mocks.state.selectQueues.set(partner, [[], [{ id: "supplier-old", name: "Proveedor", type: "SUPPLIER", taxIdNormalized: "ESB87654315" }]]);

    await createExpenseInvoice(baseInput({ supplierPartnerId: undefined, supplierName: "Proveedor", supplierTaxId: "B12345674" }));

    expect(mocks.state.updates.some((entry) => entry.table === partner && "taxId" in entry.values)).toBe(false);
    expect(mocks.state.inserts.find((entry) => entry.table === partner)?.values).toMatchObject({ name: "Proveedor", taxId: "B12345674" });
  });
});

describe("deleteVoidedExpenseInvoice", () => {
  const input = { tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", id: "supplier-invoice-1" };

  it("keeps the voided invoice and its entries when an entry falls in a closed or filed period", async () => {
    mocks.state.selectResults.set(supplierInvoice, [{ id: "supplier-invoice-1", number: "FP-2026-0001", status: "VOID" }]);
    mocks.state.selectResults.set(supplierInvoicePayment, []);
    mocks.state.selectResults.set(supplierPayment, []);
    mocks.state.selectResults.set(journalEntry, [{ id: "entry-1", number: "AS-2026/000010", postedAt: new Date("2026-03-10T12:00:00.000Z") }]);
    mocks.assertFiscalPeriodOpen.mockRejectedValueOnce(new AccountingRuleError(409, "FISCAL_PERIOD_LOCKED", "Periodo presentado"));
    const remove = vi.fn();
    Object.assign(mocks.tx, { delete: remove });

    await expect(deleteVoidedExpenseInvoice(input)).rejects.toThrow(/AS-2026\/000010 del 2026-03-10/);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("registration date and stored prorrata", () => {
  it("stores the registration date and today's prorrata, and posts on the registration date", async () => {
    mocks.state.selectResults.set(companySettings, [{ prorrataPct: "80" }]);
    const accountingDate = new Date("2026-07-02T12:00:00.000Z");

    await createExpenseInvoice(baseInput({ accountingDate }));

    expect(insertedHeader()).toMatchObject({ accountingDate, prorrataPct: "80", issueDate: new Date("2026-05-10T12:00:00.000Z") });
    expect(mocks.assertFiscalPeriodOpen).toHaveBeenCalledWith("company-1", accountingDate, expect.anything());
    expect(mocks.postSupplierInvoice).toHaveBeenCalledWith(expect.objectContaining({ postedAt: accountingDate, prorrataPct: 80 }));
  });

  it("explains how to register a late invoice when the invoice period is filed", async () => {
    mocks.assertFiscalPeriodOpen.mockRejectedValueOnce(new AccountingRuleError(409, "FISCAL_PERIOD_LOCKED", "El periodo fiscal 2T del modelo 303 ya está presentado y bloqueado."));

    await expect(createExpenseInvoice(baseInput())).rejects.toThrow(/indica una fecha de registro en un periodo abierto/);
  });
});

describe("voidExpenseInvoice", () => {
  const input = { tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", id: "supplier-invoice-1" };

  it("reverses in the invoice's own period when it is still open and records the annulment date", async () => {
    const accountingDate = new Date("2026-05-10T12:00:00.000Z");
    // 1.ª consulta: la factura; 2.ª: sus rectificativas vivas (ninguna).
    mocks.state.selectQueues.set(supplierInvoice, [[{ id: "supplier-invoice-1", status: "POSTED", number: "FP-2026-0001", accountingDate, purchaseOrderId: null }], []]);
    mocks.state.selectResults.set(supplierInvoicePayment, []);

    await voidExpenseInvoice(input);

    expect(mocks.resolveOpenPostingDate).toHaveBeenCalledWith("company-1", accountingDate, expect.any(Date), expect.anything());
    expect(mocks.state.updates.find((entry) => entry.table === supplierInvoice)?.values).toMatchObject({ status: "VOID", voidedAt: accountingDate });
  });
});

describe("voidExpenseInvoice con rectificativas", () => {
  it("no anula una factura que tiene una rectificativa viva", async () => {
    mocks.state.selectQueues.set(supplierInvoice, [
      [{ id: "supplier-invoice-1", status: "POSTED", number: "FP-2026-0001", accountingDate: new Date("2026-05-10T12:00:00.000Z"), purchaseOrderId: null }],
      [{ number: "FP-2026-0009" }],
    ]);
    mocks.state.selectResults.set(supplierInvoicePayment, []);

    await expect(voidExpenseInvoice({ tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", id: "supplier-invoice-1" })).rejects.toThrow(/rectificativa FP-2026-0009/);
  });
});

describe("computeSupplierInvoiceAmounts con signo (rectificativas)", () => {
  it("un abono sale con todos sus importes en negativo y es el espejo de la factura", () => {
    const lines = [
      { description: "A", quantity: 3, unitPrice: 0.35, taxRate: 21, retentionRate: 15 },
      { description: "B", quantity: 1, unitPrice: 99.99, taxRate: 10 },
    ];
    const invoice = computeSupplierInvoiceAmounts(lines, "DOMESTIC");
    const credit = computeSupplierInvoiceAmounts(lines.map((line) => ({ ...line, quantity: -line.quantity })), "DOMESTIC", 21, { allowNegative: true });

    expect(credit.subtotalAmount).toBe(-invoice.subtotalAmount);
    expect(credit.taxAmount).toBe(-invoice.taxAmount);
    expect(credit.retentionAmount).toBe(-invoice.retentionAmount);
    expect(credit.totalAmount).toBe(-invoice.totalAmount);
    expect(credit.lines.map((line) => line.lineTotal)).toEqual(invoice.lines.map((line) => -line.lineTotal));
  });

  it("sin allowNegative una cantidad negativa no genera importes (una factura normal nunca es negativa)", () => {
    const amounts = computeSupplierInvoiceAmounts([{ description: "A", quantity: -1, unitPrice: 100, taxRate: 21 }], "DOMESTIC");
    expect(amounts).toMatchObject({ subtotalAmount: 0, taxAmount: 0, totalAmount: 0 });
  });

  it("abono parcial con líneas de distinto signo", () => {
    const amounts = computeSupplierInvoiceAmounts(
      [
        { description: "Devolución", quantity: -2, unitPrice: 50, taxRate: 21 },
        { description: "Portes de la devolución", quantity: 1, unitPrice: 10, taxRate: 21 },
      ],
      "DOMESTIC",
      21,
      { allowNegative: true },
    );
    expect(amounts).toMatchObject({ subtotalAmount: -90, taxAmount: -18.9, totalAmount: -108.9 });
  });

  it("abono de una adquisición intracomunitaria: autorepercusión negativa y a devolver solo la base", () => {
    const amounts = computeSupplierInvoiceAmounts([{ description: "A", quantity: -1, unitPrice: 200, taxRate: 10 }], "INTRA_EU", 21, { allowNegative: true });
    expect(amounts).toMatchObject({ subtotalAmount: -200, taxAmount: -20, totalAmount: -200 });
    const withoutRate = computeSupplierInvoiceAmounts([{ description: "A", quantity: -1, unitPrice: 200, taxRate: 0 }], "REVERSE_CHARGE", 21, { allowNegative: true });
    expect(withoutRate).toMatchObject({ taxAmount: -42, totalAmount: -200 });
  });

  it("el asiento de un abono sin retención cuadra con el asiento automático actual, invertido", async () => {
    const { buildSupplierInvoiceLines, normalizePostingLines } = await vi.importActual<typeof import("@/server/accounting/auto-post")>("@/server/accounting/auto-post");
    const amounts = computeSupplierInvoiceAmounts([{ description: "A", quantity: -1, unitPrice: 100, taxRate: 21, taxDeductiblePct: 50 }], "DOMESTIC", 21, { allowNegative: true });
    const lines = normalizePostingLines(buildSupplierInvoiceLines({
      accounts: { purchase: "600", supplier: "400", vatInput: "472", vatOutput: "477", withholdingPayable: "4751" },
      expenseLines: amounts.lines.map((line) => ({ accountId: "600", subtotal: line.subtotalAmount, taxAmount: line.taxAmount, taxDeductiblePct: line.taxDeductiblePct, retentionAmount: line.retentionAmount })),
      totalAmount: amounts.totalAmount,
      prorrataPct: 100,
      vatTreatment: "DOMESTIC",
    }));
    const byAccount = Object.fromEntries(lines.map((line) => [line.accountId, { debit: Number(line.debit), credit: Number(line.credit) }]));

    // Proveedor al debe (nos debe 121), gasto e IVA deducible al haber.
    expect(byAccount["400"]).toEqual({ debit: 121, credit: 0 });
    expect(byAccount["600"]).toEqual({ debit: 0, credit: 110.5 });
    expect(byAccount["472"]).toEqual({ debit: 0, credit: 10.5 });
  });
});

describe("recargo de equivalencia soportado", () => {
  it("va aparte de la cuota de IVA y se suma al total a pagar", () => {
    const amounts = computeSupplierInvoiceAmounts([{ description: "Género", quantity: 1, unitPrice: 100, taxRate: 21, surchargeRate: 5.2 }], "DOMESTIC");
    expect(amounts).toMatchObject({ subtotalAmount: 100, taxAmount: 21, surchargeAmount: 5.2, totalAmount: 126.2 });
    expect(amounts.lines[0]).toMatchObject({ taxAmount: 21, surchargeRate: 5.2, surchargeAmount: 5.2, lineTotal: 126.2 });
  });

  it("no se aplica en autorepercusión ni en operaciones no sujetas", () => {
    const line = { description: "Género", quantity: 1, unitPrice: 100, taxRate: 21, surchargeRate: 5.2 };
    expect(computeSupplierInvoiceAmounts([line], "INTRA_EU")).toMatchObject({ surchargeAmount: 0, totalAmount: 100 });
    expect(computeSupplierInvoiceAmounts([line], "NOT_SUBJECT")).toMatchObject({ surchargeAmount: 0, taxAmount: 0, totalAmount: 100 });
  });

  it("se contabiliza como mayor importe de la compra (no deducible) y rechaza el recargo en intracomunitarias", async () => {
    await createExpenseInvoice(baseInput({ lines: [{ description: "Género", quantity: 1, unitPrice: 100, taxRate: 21, surchargeRate: 5.2 }] }));

    expect(totalsUpdate()).toMatchObject({ taxAmount: "21.00", surchargeAmount: "5.20", totalAmount: "126.20" });
    expect(insertedLines()[0]).toMatchObject({ surchargeRate: "5.200", surchargeAmount: "5.20", lineTotal: "126.20" });
    expect(mocks.postSupplierInvoice.mock.calls[0][0].expenseLines[0]).toMatchObject({ subtotal: 105.2, taxAmount: 21 });

    await expect(createExpenseInvoice(baseInput({ vatTreatment: "INTRA_EU", lines: [{ description: "Género", quantity: 1, unitPrice: 100, taxRate: 21, surchargeRate: 5.2 }] }))).rejects.toThrow(/recargo de equivalencia/);
  });
});

describe("createExpenseInvoice: rectificativas y abonos", () => {
  const original = { id: "si-original", number: "FP-2026-0003", supplierPartnerId: "supplier-1", supplierDocumentNumber: "A-118", issueDate: new Date("2026-04-02T12:00:00.000Z"), status: "POSTED" };
  const creditLines = [{ description: "Devolución", quantity: -1, unitPrice: 1_000, taxRate: 21 }];

  it("una factura normal sigue rechazando importes negativos", async () => {
    await expect(createExpenseInvoice(baseInput({ lines: creditLines }))).rejects.toThrow(/mayor que cero/);
    expect(mocks.state.inserts).toHaveLength(0);
  });

  it("registra el abono en negativo, enlazado a la factura rectificada y sin nada pendiente de pago", async () => {
    mocks.state.selectResults.set(partner, [{ ...supplierRow("ES")[0], paymentTermsDays: 30 }]);
    mocks.state.selectResults.set(supplierInvoice, [original]);

    await createExpenseInvoice(baseInput({ documentKind: "RECTIFICATION", rectifiedInvoiceId: "si-original", rectificationReason: " Devolución de mercancía ", lines: creditLines }));

    expect(insertedHeader()).toMatchObject({
      documentKind: "RECTIFICATION",
      rectifiedInvoiceId: "si-original",
      // Número y fecha de la factura rectificada, tomados de la original.
      rectifiedDocumentNumber: "A-118",
      rectifiedIssueDate: original.issueDate,
      rectificationReason: "Devolución de mercancía",
      // Un abono no vence aunque el proveedor tenga días de pago.
      dueDate: null,
    });
    expect(insertedLines()[0]).toMatchObject({ quantity: "-1.000", subtotalAmount: "-1000.00", taxAmount: "-210.00", lineTotal: "-1210.00" });
    expect(totalsUpdate()).toMatchObject({ subtotalAmount: "-1000.00", taxAmount: "-210.00", totalAmount: "-1210.00", paymentStatus: "PAID" });
    expect(mocks.postSupplierInvoice).toHaveBeenCalledWith(expect.objectContaining({
      reference: "Rectificativa proveedor FP-2026-0001",
      subtotal: -1000,
      taxAmount: -210,
      totalAmount: -1210,
    }));
    // El abono se compensa en el acto contra la factura que rectifica.
    expect(mocks.applySupplierCreditInTransaction).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ companyId: "company-1" }), { creditInvoiceId: "supplier-invoice-1", supplierInvoiceId: "si-original" });
  });

  it("admite la rectificativa con solo el número del proveedor (factura no registrada) o solo el motivo", async () => {
    await createExpenseInvoice(baseInput({ documentKind: "RECTIFICATION", rectifiedDocumentNumber: "F-77", rectifiedIssueDate: new Date("2026-03-01T12:00:00.000Z"), lines: creditLines }));
    expect(insertedHeader()).toMatchObject({ documentKind: "RECTIFICATION", rectifiedInvoiceId: null, rectifiedDocumentNumber: "F-77" });

    await expect(createExpenseInvoice(baseInput({ documentKind: "RECTIFICATION", lines: creditLines }))).rejects.toThrow(/factura que se rectifica/);
  });

  it("rechaza rectificar una factura de otro proveedor o anulada", async () => {
    mocks.state.selectResults.set(supplierInvoice, [{ ...original, supplierPartnerId: "supplier-2" }]);
    await expect(createExpenseInvoice(baseInput({ documentKind: "RECTIFICATION", rectifiedInvoiceId: "si-original", lines: creditLines }))).rejects.toThrow(/otro proveedor/);

    mocks.state.selectResults.set(supplierInvoice, [{ ...original, status: "VOID" }]);
    await expect(createExpenseInvoice(baseInput({ documentKind: "RECTIFICATION", rectifiedInvoiceId: "si-original", lines: creditLines }))).rejects.toThrow(/anulada/);
  });

  it("no enlaza la rectificativa con pedidos ni recepciones", async () => {
    await createExpenseInvoice(baseInput({ documentKind: "RECTIFICATION", rectificationReason: "Rappel", purchaseOrderId: "po-1", goodsReceiptId: "gr-1", lines: creditLines }));
    expect(insertedHeader()).toMatchObject({ purchaseOrderId: null, goodsReceiptId: null, origin: "EXPENSE" });
  });

  it("una factura normal no guarda datos de rectificación aunque lleguen", async () => {
    await createExpenseInvoice(baseInput({ rectifiedDocumentNumber: "F-77", rectificationReason: "x" }));
    expect(insertedHeader()).toMatchObject({ documentKind: "INVOICE", rectifiedInvoiceId: null, rectifiedDocumentNumber: null, rectificationReason: null });
  });
});

describe("createExpenseInvoice: campos del libro registro", () => {
  it("guarda la fecha de operación solo si es distinta de la de expedición", async () => {
    await createExpenseInvoice(baseInput({ operationDate: new Date("2026-04-28T12:00:00.000Z") }));
    expect((insertedHeader().operationDate as Date).toISOString()).toBe("2026-04-28T12:00:00.000Z");

    mocks.state.inserts.length = 0;
    await createExpenseInvoice(baseInput({ operationDate: new Date("2026-05-10T08:00:00.000Z") }));
    expect(insertedHeader().operationDate).toBeNull();
  });

  it("guarda el DUA solo en importaciones", async () => {
    const dua = { importDuaNumber: " 26ES00280112345678 ", importDuaDate: new Date("2026-05-08T12:00:00.000Z") };
    await createExpenseInvoice(baseInput({ ...dua, vatTreatment: "IMPORT" }));
    expect(insertedHeader()).toMatchObject({ importDuaNumber: "26ES00280112345678", importDuaDate: dua.importDuaDate });

    mocks.state.inserts.length = 0;
    await createExpenseInvoice(baseInput(dua));
    expect(insertedHeader()).toMatchObject({ importDuaNumber: null, importDuaDate: null });
  });

  it("marca bien de inversión de forma explícita o, sin indicar, por la cuenta del grupo 2", async () => {
    mocks.state.selectResults.set(accountChart, [{ id: "account-217", code: "21700000", name: "Equipos", type: "ASSET" }]);
    await createExpenseInvoice(baseInput({ lines: [
      { description: "Ordenador", quantity: 1, unitPrice: 900, taxRate: 21, expenseAccountId: "account-217" },
      { description: "Ordenador de segunda mano para piezas", quantity: 1, unitPrice: 90, taxRate: 21, expenseAccountId: "account-217", isInvestmentGood: false },
    ] }));
    expect(insertedLines().map((line) => line.isInvestmentGood)).toEqual([true, false]);
  });

  it("con requireSupplierTaxId exige el NIF del proveedor salvo factura simplificada", async () => {
    mocks.state.selectResults.set(partner, [{ ...supplierRow("ES")[0], taxId: null }]);

    await expect(createExpenseInvoice(baseInput({ requireSupplierTaxId: true }))).rejects.toThrow(/NIF del proveedor/);

    await createExpenseInvoice(baseInput({ requireSupplierTaxId: true, isSimplified: true }));
    expect(insertedHeader()).toMatchObject({ isSimplified: true });

    // Sin la exigencia (p. ej. gastos recurrentes) se mantiene el comportamiento anterior.
    mocks.state.inserts.length = 0;
    await createExpenseInvoice(baseInput());
    expect(insertedHeader()).toMatchObject({ isSimplified: false });
  });
});

describe("refreshSupplierInvoicePaymentStatus de un abono", () => {
  it("un abono vencido sin pagos no queda pendiente ni vencido", async () => {
    mocks.state.selectResults.set(supplierInvoice, [{ id: "supplier-invoice-1", totalAmount: "-121.00", dueDate: new Date("2020-01-01T00:00:00.000Z") }]);
    mocks.state.selectResults.set(supplierInvoicePayment, [{ paidAmount: "0" }]);

    await refreshSupplierInvoicePaymentStatus("company-1", "supplier-invoice-1", mocks.tx as never);

    expect(mocks.state.updates.at(-1)?.values).toMatchObject({ paymentStatus: "PAID" });
  });
});

describe("buildPostingExpenseLines", () => {
  const accounts = { purchase: "600", supplier: "400", vatInput: "472", vatOutput: "477", withholdingPayable: "4751" };

  it("un abono de varias líneas cuadra con el total del documento aunque el IVA por tipo difiera de la suma por línea", async () => {
    const { buildSupplierInvoiceLines, normalizePostingLines } = await vi.importActual<typeof import("@/server/accounting/auto-post")>("@/server/accounting/auto-post");
    // 3 × 0,35 al 21 %: cuota por línea 0,07 (suma 0,21) y cuota del documento 0,22.
    const lines = [1, 2, 3].map((index) => ({ description: `Línea ${index}`, quantity: -1, unitPrice: 0.35, taxRate: 21 }));
    const amounts = computeSupplierInvoiceAmounts(lines, "DOMESTIC", 21, { allowNegative: true });
    expect(amounts).toMatchObject({ subtotalAmount: -1.05, taxAmount: -0.22, totalAmount: -1.27 });

    const expenseLines = buildPostingExpenseLines(amounts, lines.map(() => "600"), { absorbRounding: true });
    // El céntimo de diferencia va a la línea de mayor importe (aquí, la primera).
    expect(expenseLines.map((line) => line.subtotal)).toEqual([-0.36, -0.35, -0.35]);

    const entry = normalizePostingLines(buildSupplierInvoiceLines({ accounts, expenseLines, totalAmount: amounts.totalAmount, prorrataPct: 100, vatTreatment: "DOMESTIC" }));
    const net = Object.fromEntries(entry.map((line) => [line.accountId, Math.round((Number(line.debit) - Number(line.credit)) * 100)]));
    expect(net).toEqual({ "400": 127, "600": -106, "472": -21 });
  });

  it("sin absorbRounding no toca las líneas (facturas normales: lo ajusta el asiento automático)", () => {
    const lines = [1, 2, 3].map((index) => ({ description: `Línea ${index}`, quantity: 1, unitPrice: 0.35, taxRate: 21 }));
    const amounts = computeSupplierInvoiceAmounts(lines, "DOMESTIC");
    expect(buildPostingExpenseLines(amounts, lines.map(() => "600")).map((line) => line.subtotal)).toEqual([0.35, 0.35, 0.35]);
  });

  it("suma el recargo de equivalencia a la base de la línea y conserva la retención con su signo", () => {
    const amounts = computeSupplierInvoiceAmounts([{ description: "A", quantity: -1, unitPrice: 100, taxRate: 21, surchargeRate: 5.2, retentionRate: 15 }], "DOMESTIC", 21, { allowNegative: true });
    expect(buildPostingExpenseLines(amounts, ["600"], { absorbRounding: true })).toEqual([
      { accountId: "600", subtotal: -105.2, taxAmount: -21, taxDeductiblePct: 100, retentionAmount: -15 },
    ]);
  });
});
