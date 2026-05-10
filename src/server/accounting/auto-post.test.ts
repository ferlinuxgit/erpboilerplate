import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];

  const createDbClientMock = () => {
    const client = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => selectResults.shift() ?? []),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "journal-entry-1" }]),
        })),
      })),
    };
    return client;
  };

  return {
    selectResults,
    createDbClientMock,
    db: createDbClientMock(),
    ensureDefaultJournal: vi.fn(async () => ({ id: "journal-1" })),
    recordAudit: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/accounting/service", () => ({ ensureDefaultJournal: mocks.ensureDefaultJournal }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));

import { postSalesInvoice } from "@/server/accounting/auto-post";

describe("accounting auto posting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.splice(
      0,
      mocks.selectResults.length,
      [],
      [{ id: "customer-account" }],
      [{ id: "supplier-account" }],
      [{ id: "sales-account" }],
      [{ id: "purchase-account" }],
      [{ id: "bank-account" }],
      [{ id: "vat-output-account" }],
      [{ id: "vat-input-account" }],
      [{ id: "retention-account" }],
    );
  });

  it("posts retained sales invoices as balanced customer, sales, VAT, and retention lines", async () => {
    const tx = mocks.createDbClientMock();

    await postSalesInvoice({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      invoiceId: "invoice-1",
      postedAt: new Date("2026-05-09"),
      reference: "Factura FAC-1",
      subtotal: 100,
      taxAmount: 21,
      retentionAmount: 15,
      totalAmount: 106,
      dbClient: tx,
    } as Parameters<typeof postSalesInvoice>[0] & { dbClient: typeof tx });

    const journalLinesInsert = tx.insert.mock.results[1]?.value.values;
    expect(journalLinesInsert).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: "customer-account", debit: "106.00", credit: "0.00" }),
      expect.objectContaining({ accountId: "sales-account", debit: "0.00", credit: "100.00" }),
      expect.objectContaining({ accountId: "vat-output-account", debit: "0.00", credit: "21.00" }),
      expect.objectContaining({ accountId: "retention-account", debit: "15.00", credit: "0.00" }),
    ]);
  });

  it("uses a supplied transaction client for every database write while posting a sales invoice", async () => {
    const tx = mocks.createDbClientMock();

    await postSalesInvoice({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      invoiceId: "invoice-1",
      postedAt: new Date("2026-05-09"),
      reference: "Factura FAC-1",
      subtotal: 100,
      taxAmount: 21,
      totalAmount: 121,
      dbClient: tx,
    } as Parameters<typeof postSalesInvoice>[0] & { dbClient: typeof tx });

    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(tx.select).toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(mocks.ensureDefaultJournal).toHaveBeenCalledWith("company-1", tx);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "user-1",
        action: "accounting.autopost.salesInvoice",
        entityName: "invoice",
        entityId: "invoice-1",
      }),
      tx,
    );
  });
});
