import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertResults: unknown[][] = [];
  const insertedValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const lockStrengths: string[] = [];
  const transactions: Array<{ committed: boolean; rolledBack: boolean; error?: unknown }> = [];

  const createThenableSelection = () => {
    const selection = {
      from: vi.fn(() => selection),
      where: vi.fn(() => selection),
      for: vi.fn((strength: string) => {
        lockStrengths.push(strength);
        return selection;
      }),
      limit: vi.fn(async () => selectResults.shift() ?? []),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
    };
    return selection;
  };

  const createDbClientMock = () => {
    const client = {
      select: vi.fn(() => createThenableSelection()),
      insert: vi.fn(() => ({
        values: vi.fn((value: unknown) => {
          insertedValues.push(value);
          return {
            returning: vi.fn(async () => insertResults.shift() ?? []),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((value: unknown) => {
          updateSets.push(value);
          return { where: vi.fn(async () => undefined) };
        }),
      })),
    };
    return client;
  };

  const tx = createDbClientMock();

  return {
    selectResults,
    insertResults,
    insertedValues,
    updateSets,
    lockStrengths,
    transactions,
    tx,
    db: {
      transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => {
        const state = { committed: false, rolledBack: false };
        transactions.push(state);
        try {
          const result = await callback(tx);
          state.committed = true;
          return result;
        } catch (error) {
          state.rolledBack = true;
          (state as { error?: unknown }).error = error;
          throw error;
        }
      }),
    },
    postSalesInvoice: vi.fn(async () => undefined),
    recordAudit: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/accounting/auto-post", () => ({ postSalesInvoice: mocks.postSalesInvoice }));
vi.mock("@/server/audit", () => ({ recordAudit: mocks.recordAudit }));

import { convertDeliveryToInvoice } from "@/server/sales/service";

const deliveryNoteRow = {
  id: "delivery-1",
  companyId: "company-1",
  customerId: "customer-1",
  salesOrderId: "order-1",
  status: "DELIVERED",
  number: "ALB-1",
};
const salesOrderRow = {
  id: "order-1",
  companyId: "company-1",
  customerId: "customer-1",
  totalAmount: "999.99",
  status: "DELIVERED",
};
const retainedSalesOrderRow = {
  ...salesOrderRow,
  subtotal: "180.00",
  taxAmount: "37.80",
  retentionAmount: "9.00",
  totalAmount: "208.80",
};
const seriesRow = { id: "series-1", prefix: "FAC-", nextNumber: 7 };
const deliveryLines = [
  {
    itemId: "item-1",
    description: "Widget shipped partially",
    quantity: "1.500",
  },
  {
    itemId: "item-2",
    description: "Service shipped",
    quantity: "1.000",
  },
];
const orderLines = [
  {
    itemId: "item-1",
    description: "Widget",
    quantity: "2.000",
    unitPrice: "100.00",
    taxRate: "21.000",
    lineTotal: "242.00",
  },
  {
    itemId: "item-2",
    description: "Service",
    quantity: "1.000",
    unitPrice: "30.00",
    taxRate: "10.000",
    lineTotal: "33.00",
  },
];

function queueSuccessfulSelects() {
  mocks.selectResults.splice(0, mocks.selectResults.length, [deliveryNoteRow], [salesOrderRow], deliveryLines, orderLines, [seriesRow]);
  mocks.insertResults.splice(0, mocks.insertResults.length, [{ id: "invoice-1", number: "FAC-000007" }]);
}

describe("convertDeliveryToInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.splice(0, mocks.selectResults.length);
    mocks.insertResults.splice(0, mocks.insertResults.length);
    mocks.insertedValues.splice(0, mocks.insertedValues.length);
    mocks.updateSets.splice(0, mocks.updateSets.length);
    mocks.lockStrengths.splice(0, mocks.lockStrengths.length);
    mocks.transactions.splice(0, mocks.transactions.length);
    mocks.postSalesInvoice.mockResolvedValue(undefined);
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  it("creates a complete invoice with copied lines, recalculated totals, accounting posting, and invoiced statuses in one transaction", async () => {
    queueSuccessfulSelects();

    const created = await convertDeliveryToInvoice({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      fiscalYearId: "fy-1",
      deliveryNoteId: "delivery-1",
    });

    expect(created).toEqual({ id: "invoice-1", number: "FAC-000007" });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.lockStrengths[0]).toBe("update");
    expect(mocks.insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId: "company-1",
          customerId: "customer-1",
          number: "FAC-000007",
          totalAmount: "214.50",
          status: "SENT",
        }),
        [
          expect.objectContaining({
            invoiceId: "invoice-1",
            itemId: "item-1",
            description: "Widget shipped partially",
            quantity: "1.500",
            unitPrice: "100.00",
            taxRate: "21.000",
            lineTotal: "181.50",
          }),
          expect.objectContaining({
            invoiceId: "invoice-1",
            itemId: "item-2",
            description: "Service shipped",
            quantity: "1.000",
            unitPrice: "30.00",
            taxRate: "10.000",
            lineTotal: "33.00",
          }),
        ],
      ]),
    );
    expect(mocks.postSalesInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "user-1",
        invoiceId: "invoice-1",
        reference: "Factura FAC-000007",
        subtotal: 180,
        taxAmount: 34.5,
        totalAmount: 214.5,
        dbClient: mocks.tx,
      }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "user-1",
        action: "sales.delivery.invoice",
        entityName: "invoice",
        entityId: "invoice-1",
        payload: expect.objectContaining({ deliveryNoteId: "delivery-1", salesOrderId: "order-1", number: "FAC-000007" }),
      }),
      mocks.tx,
    );
    const invoicedStatusUpdates = mocks.updateSets.filter(
      (value): value is { status: string } => typeof value === "object" && value !== null && "status" in value,
    );
    expect(invoicedStatusUpdates).toEqual([
      expect.objectContaining({ status: "INVOICED" }),
      expect.objectContaining({ status: "INVOICED" }),
    ]);
  });

  it("preserves discounted and retained order totals when generating invoice and accounting entries", async () => {
    mocks.selectResults.splice(0, mocks.selectResults.length, [deliveryNoteRow], [retainedSalesOrderRow], [
      {
        itemId: "item-1",
        description: "Discounted Widget",
        quantity: "2.000",
      },
    ], [
      {
        itemId: "item-1",
        description: "Discounted Widget",
        quantity: "2.000",
        unitPrice: "100.00",
        discountPct: "10.000",
        taxRate: "21.000",
        retentionRate: "5.000",
        lineTotal: "208.80",
      },
    ], [seriesRow]);
    mocks.insertResults.splice(0, mocks.insertResults.length, [{ id: "invoice-1", number: "FAC-000007" }]);

    await convertDeliveryToInvoice({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      fiscalYearId: "fy-1",
      deliveryNoteId: "delivery-1",
    });

    expect(mocks.insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalAmount: "208.80" }),
        [expect.objectContaining({ lineTotal: "208.80" })],
      ]),
    );
    expect(mocks.postSalesInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 180, taxAmount: 37.8, retentionAmount: 9, totalAmount: 208.8 }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ totalAmount: 208.8 }) }),
      mocks.tx,
    );
  });

  it("matches repeated item lines by their delivery description so partial invoices keep the right source prices", async () => {
    mocks.selectResults.splice(0, mocks.selectResults.length, [deliveryNoteRow], [salesOrderRow], [
      {
        itemId: "item-1",
        description: "Widget premium shipped",
        quantity: "1.000",
      },
      {
        itemId: "item-1",
        description: "Widget economy shipped",
        quantity: "2.000",
      },
    ], [
      {
        itemId: "item-1",
        description: "Widget premium shipped",
        quantity: "1.000",
        unitPrice: "150.00",
        taxRate: "21.000",
        lineTotal: "181.50",
      },
      {
        itemId: "item-1",
        description: "Widget economy shipped",
        quantity: "2.000",
        unitPrice: "40.00",
        taxRate: "21.000",
        lineTotal: "96.80",
      },
    ], [seriesRow]);
    mocks.insertResults.splice(0, mocks.insertResults.length, [{ id: "invoice-1", number: "FAC-000007" }]);

    await convertDeliveryToInvoice({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      fiscalYearId: "fy-1",
      deliveryNoteId: "delivery-1",
    });

    expect(mocks.insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalAmount: "278.30" }),
        [
          expect.objectContaining({
            description: "Widget premium shipped",
            quantity: "1.000",
            unitPrice: "150.00",
            lineTotal: "181.50",
          }),
          expect.objectContaining({
            description: "Widget economy shipped",
            quantity: "2.000",
            unitPrice: "40.00",
            lineTotal: "96.80",
          }),
        ],
      ]),
    );
  });

  it("refuses to invoice a delivery note without source order lines", async () => {
    mocks.selectResults.splice(0, mocks.selectResults.length, [deliveryNoteRow], [salesOrderRow], deliveryLines, []);

    await expect(
      convertDeliveryToInvoice({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "user-1",
        fiscalYearId: "fy-1",
        deliveryNoteId: "delivery-1",
      }),
    ).rejects.toThrow(/líneas del pedido/);

    expect(mocks.postSalesInvoice).not.toHaveBeenCalled();
    expect(mocks.insertedValues).toEqual([]);
  });

  it("keeps the conversion retry-safe by not marking delivery/order invoiced when accounting posting fails", async () => {
    queueSuccessfulSelects();
    mocks.postSalesInvoice.mockRejectedValueOnce(new Error("posting failed"));

    await expect(
      convertDeliveryToInvoice({
        tenantId: "tenant-1",
        companyId: "company-1",
        actorUserId: "user-1",
        fiscalYearId: "fy-1",
        deliveryNoteId: "delivery-1",
      }),
    ).rejects.toThrow(/posting failed/);

    expect(mocks.postSalesInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.updateSets).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: "INVOICED" })]));
    expect(mocks.transactions).toEqual([expect.objectContaining({ committed: false, rolledBack: true })]);
  });

  it("returns the existing invoice without duplicating writes when an invoiced delivery is retried", async () => {
    mocks.selectResults.splice(
      0,
      mocks.selectResults.length,
      [{ ...deliveryNoteRow, status: "INVOICED" }],
      [
        {
          entityId: "invoice-1",
          payload: JSON.stringify({ deliveryNoteId: "delivery-1", salesOrderId: "order-1", number: "FAC-000007" }),
        },
      ],
      [{ id: "invoice-1", number: "FAC-000007" }],
    );

    const existing = await convertDeliveryToInvoice({
      tenantId: "tenant-1",
      companyId: "company-1",
      actorUserId: "user-1",
      fiscalYearId: "fy-1",
      deliveryNoteId: "delivery-1",
    });

    expect(existing).toEqual({ id: "invoice-1", number: "FAC-000007" });
    expect(mocks.insertedValues).toEqual([]);
    expect(mocks.updateSets).toEqual([]);
    expect(mocks.postSalesInvoice).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.transactions).toEqual([expect.objectContaining({ committed: true, rolledBack: false })]);
  });
});
