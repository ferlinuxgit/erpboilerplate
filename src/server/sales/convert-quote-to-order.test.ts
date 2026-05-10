import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertResults: unknown[][] = [];
  const insertedValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const lockModes: string[] = [];

  const createThenableSelection = () => {
    const selection = {
      from: vi.fn(() => selection),
      where: vi.fn(() => selection),
      for: vi.fn((mode: string) => {
        lockModes.push(mode);
        return selection;
      }),
      limit: vi.fn(async () => selectResults.shift() ?? []),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
    };
    return selection;
  };

  const tx = {
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

  return {
    selectResults,
    insertResults,
    insertedValues,
    updateSets,
    tx,
    db: {
      transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/server/accounting/auto-post", () => ({ postSalesInvoice: vi.fn() }));
vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

import { convertQuoteToOrder } from "@/server/sales/service";

const quoteRow = {
  id: "quote-1",
  companyId: "company-1",
  customerId: "customer-1",
  status: "SENT",
  subtotal: "100.00",
  taxAmount: "21.00",
  retentionAmount: "0.00",
  totalAmount: "121.00",
};
const seriesRow = { id: "series-1", prefix: "PED-", nextNumber: 12 };
const quoteLines = [
  {
    itemId: "item-1",
    description: "Servicio de consultoría",
    quantity: "2.000",
    unitPrice: "50.00",
    discountPct: "0.000",
    taxRate: "21.000",
    lineTotal: "121.00",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectResults.splice(0, mocks.selectResults.length);
  mocks.insertResults.splice(0, mocks.insertResults.length);
  mocks.insertedValues.splice(0, mocks.insertedValues.length);
  mocks.updateSets.splice(0, mocks.updateSets.length);
});

describe("convertQuoteToOrder", () => {
  it("copies quote lines into the created order so later delivery-to-invoice conversion has billable lines", async () => {
    mocks.selectResults.splice(0, mocks.selectResults.length, [quoteRow], [seriesRow], quoteLines);
    mocks.insertResults.splice(0, mocks.insertResults.length, [{ id: "order-1", number: "PED-000012" }]);

    const created = await convertQuoteToOrder({ companyId: "company-1", fiscalYearId: "fy-1", quoteId: "quote-1" });

    expect(created).toEqual({ id: "order-1", number: "PED-000012" });
    expect(mocks.insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ salesQuoteId: "quote-1", number: "PED-000012", status: "CONFIRMED" }),
        [
          expect.objectContaining({
            salesOrderId: "order-1",
            itemId: "item-1",
            description: "Servicio de consultoría",
            quantity: "2.000",
            unitPrice: "50.00",
            taxRate: "21.000",
            lineTotal: "121.00",
          }),
        ],
      ]),
    );
    expect(mocks.updateSets).toEqual(expect.arrayContaining([expect.objectContaining({ status: "CONFIRMED" })]));
  });
});
