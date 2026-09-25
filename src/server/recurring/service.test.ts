import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Motor de recurrencias con la base de datos simulada: comprueba que cada periodo se genera una
 * sola vez (bloqueo de la plantilla + `recurring_run` único) y que un fallo al emitir conserva
 * el borrador.
 */

type Call = { op: string; method: string; args: unknown[] };

const mocks = vi.hoisted(() => {
  const calls: Call[] = [];
  const queues: Record<string, unknown[][]> = { select: [], insert: [], update: [] };
  function chain(op: string) {
    let resolved: unknown[] | undefined;
    const proxy: unknown = new Proxy(() => undefined, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            if (resolved === undefined) resolved = queues[op]?.shift() ?? [];
            return Promise.resolve(resolved).then(resolve, reject);
          };
        }
        return (...args: unknown[]) => {
          calls.push({ op, method: String(prop), args });
          return proxy;
        };
      },
    });
    return proxy;
  }
  const client = {
    select: vi.fn(() => chain("select")),
    insert: vi.fn(() => chain("insert")),
    update: vi.fn(() => chain("update")),
    delete: vi.fn(() => chain("delete")),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown): Promise<unknown> => callback(client)),
  };
  return {
    calls,
    queues,
    db: client,
    createDraftInvoiceInTransaction: vi.fn(async () => ({ id: "inv-new", number: "BORRADOR-1", status: "DRAFT" })),
    issueInvoiceInTransaction: vi.fn(),
    ensureCompanyDefaults: vi.fn(async () => undefined),
    createExpenseInvoice: vi.fn(),
    sendInvoiceEmail: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/server/inventory/ownership", () => ({ assertItemsBelongToCompany: vi.fn(async () => undefined) }));
vi.mock("@/server/invoices/payment-methods", () => ({ resolveInvoicePaymentMethods: vi.fn(async () => []) }));
vi.mock("@/server/invoices/service", () => ({
  createDraftInvoiceInTransaction: mocks.createDraftInvoiceInTransaction,
  ensureCompanyDefaults: mocks.ensureCompanyDefaults,
  issueInvoiceInTransaction: mocks.issueInvoiceInTransaction,
  loadStoredLines: vi.fn(async () => []),
  resolveCustomerBillingDefaults: vi.fn(async () => ({ countryCode: "ES", termsDays: 30, vatTreatment: "DOMESTIC", retentionRate: null, equivalenceSurcharge: false, paymentMethodIds: [] })),
}));
vi.mock("@/server/invoice-email/service", () => ({ sendInvoiceEmail: mocks.sendInvoiceEmail }));
vi.mock("@/server/sales/service", () => ({ mapSalesLineTaxes: vi.fn(() => []) }));
vi.mock("@/server/supplier-invoices/service", () => ({ createExpenseInvoice: mocks.createExpenseInvoice }));

import { HttpError } from "@/lib/http";
import { runDueRecurringTemplates } from "@/server/recurring/service";

const now = new Date("2026-09-25T08:00:00.000Z");

function template(patch: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    companyId: "c-1",
    kind: "EXPENSE",
    name: "Alquiler oficina",
    status: "ACTIVE",
    customerId: null,
    supplierPartnerId: "sup-1",
    frequency: "MONTHLY",
    intervalMonths: 1,
    startDate: "2026-09-01",
    endDate: null,
    dayOfMonth: 1,
    maxOccurrences: null,
    issueMode: "DRAFT",
    lines: [{ description: "Alquiler {mes} {año}", quantity: 1, unitPrice: 650, taxRate: 21, retentionRate: 19, expenseAccountId: "acc-621", taxDeductiblePct: 100 }],
    notes: null,
    vatTreatment: null,
    sourceInvoiceId: null,
    nextRunDate: "2026-09-01",
    occurrencesGenerated: 0,
    lastRunAt: null,
    lastError: null,
    createdByUserId: "u-1",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function candidate(row: ReturnType<typeof template>) {
  return { template: row, tenantId: "t-1", countryCode: "ES", timezone: "Europe/Madrid", ownerId: "owner-1" };
}

function updateSets() {
  return mocks.calls.filter((call) => call.op === "update" && call.method === "set").map((call) => call.args[0] as Record<string, unknown>);
}

function insertedValues() {
  return mocks.calls.filter((call) => call.op === "insert" && call.method === "values").map((call) => call.args[0] as Record<string, unknown>);
}

beforeEach(() => {
  mocks.calls.length = 0;
  for (const key of Object.keys(mocks.queues)) mocks.queues[key] = [];
  vi.clearAllMocks();
});

describe("runDueRecurringTemplates", () => {
  it("deja el gasto del periodo pendiente de revisar con el concepto rellenado y avanza la plantilla", async () => {
    const row = template();
    mocks.queues.select.push([candidate(row)], [row], [{ ...row, nextRunDate: "2026-10-01", occurrencesGenerated: 1 }]);
    mocks.queues.insert.push([{ id: "run-1" }]);

    const summary = await runDueRecurringTemplates({ now });

    expect(summary).toEqual({ templates: 1, generated: 0, pendingReview: 1, failed: 0 });
    const run = insertedValues()[0];
    expect(run).toMatchObject({ templateId: "tpl-1", periodDate: "2026-09-01", status: "PENDING_REVIEW" });
    expect(run?.payload).toMatchObject({ lines: [expect.objectContaining({ description: "Alquiler septiembre 2026" })] });
    expect(updateSets()[0]).toMatchObject({ occurrencesGenerated: 1, nextRunDate: "2026-10-01", status: "ACTIVE" });
    expect(mocks.createExpenseInvoice).not.toHaveBeenCalled();
  });

  it("si otro proceso ya generó el periodo (conflicto único) no crea nada y no cuenta la emisión", async () => {
    const row = template();
    mocks.queues.select.push([candidate(row)], [row], [{ ...row, nextRunDate: "2026-10-01" }]);
    mocks.queues.insert.push([]);

    const summary = await runDueRecurringTemplates({ now });

    expect(summary.pendingReview).toBe(0);
    expect(updateSets()[0]).toMatchObject({ occurrencesGenerated: 0, nextRunDate: "2026-10-01" });
  });

  it("si la plantilla ya no está pendiente de ese periodo (bloqueada o avanzada) no hace nada", async () => {
    const row = template();
    mocks.queues.select.push([candidate(row)], [], [{ ...row, nextRunDate: "2026-10-01" }]);

    const summary = await runDueRecurringTemplates({ now });

    expect(summary.pendingReview).toBe(0);
    expect(insertedValues()).toHaveLength(0);
    expect(updateSets()).toHaveLength(0);
  });

  it("recupera varios periodos atrasados de una vez", async () => {
    const row = template({ startDate: "2026-07-01", nextRunDate: "2026-07-01" });
    const afterJuly = { ...row, nextRunDate: "2026-08-01", occurrencesGenerated: 1 };
    const afterAugust = { ...row, nextRunDate: "2026-09-01", occurrencesGenerated: 2 };
    const afterSeptember = { ...row, nextRunDate: "2026-10-01", occurrencesGenerated: 3 };
    mocks.queues.select.push([candidate(row)], [row], [afterJuly], [afterJuly], [afterAugust], [afterAugust], [afterSeptember]);
    mocks.queues.insert.push([{ id: "run-7" }], [{ id: "run-8" }], [{ id: "run-9" }]);

    const summary = await runDueRecurringTemplates({ now });

    expect(summary.pendingReview).toBe(3);
    expect(insertedValues().map((values) => values.periodDate)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  it("factura en modo emitir: si la emisión falla conserva el borrador y lo explica", async () => {
    const row = template({ kind: "SALES_INVOICE", customerId: "cus-1", supplierPartnerId: null, issueMode: "ISSUE", lines: [{ description: "Mantenimiento {mes}", quantity: 1, unitPrice: 100, taxRate: 21, retentionRate: 0 }] });
    mocks.issueInvoiceInTransaction.mockRejectedValue(new HttpError(409, "El periodo fiscal está cerrado."));
    // candidatos, ejercicio fiscal, bloqueo, impuestos, recarga
    mocks.queues.select.push([candidate(row)], [{ id: "fy-2026" }], [row], [], [{ ...row, nextRunDate: "2026-10-01" }]);
    mocks.queues.insert.push([{ id: "run-1" }]);

    const summary = await runDueRecurringTemplates({ now });

    expect(summary.generated).toBe(1);
    expect(mocks.createDraftInvoiceInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: "c-1", actorUserId: "u-1", activeFiscalYearId: "fy-2026" }),
      expect.objectContaining({ customerId: "cus-1", issueDate: new Date("2026-09-01T00:00:00.000Z"), lines: [expect.objectContaining({ description: "Mantenimiento septiembre" })] }),
    );
    const runUpdate = updateSets().find((set) => "invoiceId" in set);
    expect(runUpdate).toMatchObject({ invoiceId: "inv-new" });
    expect(String(runUpdate?.message)).toContain("queda en borrador");
    expect(mocks.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("factura en modo emitir y enviar: envía el email tras emitir", async () => {
    const row = template({ kind: "SALES_INVOICE", customerId: "cus-1", supplierPartnerId: null, issueMode: "ISSUE_AND_EMAIL", lines: [{ description: "Cuota", quantity: 1, unitPrice: 100, taxRate: 21, retentionRate: 0 }] });
    mocks.issueInvoiceInTransaction.mockResolvedValue({ id: "inv-new", number: "F-1", status: "SENT", invoiceType: "INVOICE", totalAmount: "121.00" });
    mocks.sendInvoiceEmail.mockResolvedValue({ status: "SENT", error: null });
    mocks.queues.select.push([candidate(row)], [{ id: "fy-2026" }], [row], [], [{ ...row, nextRunDate: "2026-10-01" }]);
    mocks.queues.insert.push([{ id: "run-1" }]);

    await runDueRecurringTemplates({ now, transport: null });

    expect(mocks.sendInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "c-1", trigger: "AUTOMATIC", actorUserId: null }),
      { invoiceId: "inv-new", kind: "INVOICE" },
      { transport: null },
    );
  });

  it("gasto en modo registrar: usa una clave de idempotencia por plantilla y periodo", async () => {
    const row = template({ issueMode: "POST" });
    mocks.createExpenseInvoice.mockResolvedValue({ id: "si-1", number: "FR-1" });
    mocks.queues.select.push([candidate(row)], [{ id: "fy-2026" }], [row], [{ ...row, nextRunDate: "2026-10-01" }]);
    mocks.queues.insert.push([{ id: "run-1" }]);

    const summary = await runDueRecurringTemplates({ now });

    expect(summary.generated).toBe(1);
    expect(mocks.createExpenseInvoice).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "recurring:tpl-1:2026-09-01", supplierPartnerId: "sup-1", fiscalYearId: "fy-2026" }));
    expect(insertedValues()[0]).toMatchObject({ status: "GENERATED", supplierInvoiceId: "si-1", payload: null });
  });
});
