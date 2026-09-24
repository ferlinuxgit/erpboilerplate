import { describe, expect, it } from "vitest";

import {
  agingBucketFor,
  cumulativeSeries,
  currentQuarter,
  daysPastDue,
  fillMonthlySeries,
  financePeriodRanges,
  lastMonths,
  mapAgingRows,
  parseFinancePeriod,
  percentChange,
  upcomingFiscalDeadlines,
} from "@/server/reporting/dashboard-model";
import { buildDashboardCockpit, buildDashboardCockpitFromSummary, summarizeDashboardInput } from "@/lib/dashboard-cockpit";

const now = new Date("2026-09-24T10:00:00.000Z");

describe("finance periods", () => {
  it("parses the selector and defaults to the month", () => {
    expect(parseFinancePeriod("quarter")).toBe("quarter");
    expect(parseFinancePeriod(["year"])).toBe("year");
    expect(parseFinancePeriod("decade")).toBe("month");
    expect(parseFinancePeriod(undefined)).toBe("month");
  });

  it("compares the month to date with the same stretch of the previous month", () => {
    const ranges = financePeriodRanges("month", now);
    expect(ranges.current.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(ranges.current.end.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(ranges.previous.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(ranges.previous.end.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(ranges.full.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("never lets the previous stretch overlap the current period", () => {
    const ranges = financePeriodRanges("month", new Date("2026-03-31T12:00:00.000Z"));
    expect(ranges.previous.start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(ranges.previous.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("builds quarter and year ranges", () => {
    const quarter = financePeriodRanges("quarter", now);
    expect(quarter.current.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(quarter.previous.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    const year = financePeriodRanges("year", now);
    expect(year.current.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(year.previous.start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(currentQuarter(now)).toMatchObject({ label: "3T 2026", end: new Date("2026-10-01T00:00:00.000Z") });
  });

  it("computes percentage change only with a base", () => {
    expect(percentChange(1200, 1000)).toBe(20);
    expect(percentChange(500, 1000)).toBe(-50);
    expect(percentChange(100, 0)).toBeNull();
  });
});

describe("aggregate row mapping", () => {
  it("buckets by days past due", () => {
    expect(agingBucketFor(null)).toBe("current");
    expect(agingBucketFor(0)).toBe("current");
    expect(agingBucketFor(1)).toBe("d0_30");
    expect(agingBucketFor(30)).toBe("d0_30");
    expect(agingBucketFor(31)).toBe("d31_60");
    expect(agingBucketFor(90)).toBe("d61_90");
    expect(agingBucketFor(91)).toBe("d90_plus");
  });

  it("maps grouped aging rows into every bucket in order", () => {
    const aging = mapAgingRows([
      { bucket: "d90_plus", amount: "300.10", count: "1" },
      { bucket: "current", amount: "1000", count: 2 },
      { bucket: "d0_30", amount: 50.2, count: "3" },
    ]);
    expect(aging.buckets.map((bucket) => [bucket.key, bucket.amount, bucket.count])).toEqual([
      ["current", 1000, 2],
      ["d0_30", 50.2, 3],
      ["d31_60", 0, 0],
      ["d61_90", 0, 0],
      ["d90_plus", 300.1, 1],
    ]);
    expect(aging.total).toBe(1350.3);
    expect(aging.overdue).toBe(350.3);
    expect(aging.count).toBe(6);
  });

  it("lists the last 12 months oldest first and fills gaps with zero", () => {
    const months = lastMonths(now, 12);
    expect(months).toHaveLength(12);
    expect(months[0].key).toBe("2025-10");
    expect(months[11].key).toBe("2026-09");
    expect(months[11].label).toBe("sept 26");
    const series = fillMonthlySeries(months, [
      { month: "2026-09", value: "100.5" },
      { month: "2025-10", value: 20 },
      { month: "2024-01", value: 999 },
    ]);
    expect(series[0]).toBe(20);
    expect(series[11]).toBe(100.5);
    expect(series.slice(1, 11).every((value) => value === 0)).toBe(true);
  });

  it("accumulates the cash balance from the opening balance", () => {
    expect(cumulativeSeries(1000, [100, -50.25, 0])).toEqual([1100, 1049.75, 1049.75]);
  });

  it("counts whole days past due", () => {
    expect(daysPastDue(new Date("2026-09-20T00:00:00.000Z"), now)).toBe(4);
    expect(daysPastDue(new Date("2026-09-30T00:00:00.000Z"), now)).toBe(0);
    expect(daysPastDue(null, now)).toBe(0);
  });
});

describe("fiscal deadlines", () => {
  it("lists the next 303 within the horizon and skips filed or pre-existing periods", () => {
    const deadlines = upcomingFiscalDeadlines({ now: new Date("2026-10-05T09:00:00.000Z"), reports: [] });
    expect(deadlines.map((deadline) => [deadline.code, deadline.period, deadline.daysUntil, deadline.status])).toEqual([["303", "2026-Q3", 15, "upcoming"]]);

    const filed = upcomingFiscalDeadlines({ now: new Date("2026-10-05T09:00:00.000Z"), reports: [{ code: "303", period: "2026-Q3", status: "FILED" }] });
    expect(filed).toEqual([]);
  });

  it("flags an overdue draft only when the company started it", () => {
    const deadlines = upcomingFiscalDeadlines({ now: new Date("2026-07-25T09:00:00.000Z"), reports: [{ code: "303", period: "2026-Q2", status: "DRAFT" }] });
    expect(deadlines).toMatchObject([{ code: "303", period: "2026-Q2", status: "overdue", periodLabel: "2T 2026" }]);
    expect(upcomingFiscalDeadlines({ now: new Date("2026-07-25T09:00:00.000Z"), reports: [] })).toEqual([]);
  });

  it("includes the annual 390 and 347 in January", () => {
    const deadlines = upcomingFiscalDeadlines({ now: new Date("2027-01-15T09:00:00.000Z"), reports: [] });
    expect(deadlines.map((deadline) => `${deadline.code}:${deadline.period}`)).toEqual(["303:2026-Q4", "390:2026"]);
  });
});

describe("cockpit from SQL counts", () => {
  it("matches the row-based cockpit for the same data", () => {
    const input = {
      now,
      customers: [{ status: "ACTIVE" }, { status: "INACTIVE" }],
      salesQuotes: [{ status: "SENT" }],
      salesOrders: [{ status: "INVOICED" }],
      deliveryNotes: [],
      invoices: [
        { id: "inv-1", dueDate: new Date("2026-09-01"), paymentStatus: "PENDING", totalAmount: "121.00" },
        { id: "inv-2", dueDate: null, paymentStatus: "PAID", totalAmount: "50.00" },
      ],
      invoicePayments: [{ invoiceId: "inv-1", amountApplied: "21.00" }],
      lowStockAlerts: [],
      inventoryItemsCount: 3,
    };
    const summary = summarizeDashboardInput(input);
    expect(summary).toEqual({
      activeCustomers: 1,
      salesInProgress: 1,
      invoiceCount: 2,
      unpaidInvoices: 1,
      overdueInvoices: 1,
      receivablesAmount: 100,
      lowStockAlerts: 0,
      hasRecordedPayment: true,
      inventoryItemsCount: 3,
    });
    expect(buildDashboardCockpitFromSummary(summary)).toEqual(buildDashboardCockpit(input));
  });

  it("ignores drafts and nets issued credit notes out of receivables", () => {
    const summary = summarizeDashboardInput({
      now,
      customers: [],
      salesQuotes: [],
      salesOrders: [],
      deliveryNotes: [],
      invoices: [
        // Issued invoice 121 € with a 21 € credit note and 50 € paid → 50 € outstanding.
        { id: "inv-1", number: "F-2026-0001", status: "SENT", issuedAt: new Date("2026-08-01"), invoiceType: "INVOICE", dueDate: new Date("2026-09-01"), paymentStatus: "PARTIAL", totalAmount: "121.00" },
        { id: "cn-1", number: "R-2026-0001", status: "SENT", issuedAt: new Date("2026-08-05"), invoiceType: "CREDIT_NOTE", rectifiedInvoiceId: "inv-1", dueDate: null, paymentStatus: "PENDING", totalAmount: "-21.00" },
        // Draft credit note: not applied yet.
        { id: "cn-2", number: "BORRADOR-AAAA1111", status: "DRAFT", issuedAt: null, invoiceType: "CREDIT_NOTE", rectifiedInvoiceId: "inv-1", dueDate: null, paymentStatus: "PENDING", totalAmount: "-10.00" },
        // Draft invoice: never a receivable, even past its due date.
        { id: "inv-2", number: "BORRADOR-BBBB2222", status: "DRAFT", issuedAt: null, invoiceType: "INVOICE", dueDate: new Date("2026-01-01"), paymentStatus: "PENDING", totalAmount: "500.00" },
        // Legacy invoice numbered at creation (status DRAFT, no issuedAt) still counts.
        { id: "inv-3", number: "F-2025-0009", status: "DRAFT", issuedAt: null, invoiceType: "INVOICE", dueDate: null, paymentStatus: "PENDING", totalAmount: "10.00" },
        // Fully credited invoice: nothing left to collect.
        { id: "inv-4", number: "F-2026-0002", status: "SENT", issuedAt: new Date("2026-08-01"), invoiceType: "INVOICE", dueDate: new Date("2026-08-15"), paymentStatus: "PENDING", totalAmount: "30.00" },
        { id: "cn-3", number: "R-2026-0002", status: "SENT", issuedAt: new Date("2026-08-02"), invoiceType: "CREDIT_NOTE", rectifiedInvoiceId: "inv-4", dueDate: null, paymentStatus: "PENDING", totalAmount: "-30.00" },
      ],
      invoicePayments: [{ invoiceId: "inv-1", amountApplied: "50.00" }],
      lowStockAlerts: [],
    });
    expect(summary.unpaidInvoices).toBe(2);
    expect(summary.overdueInvoices).toBe(1);
    expect(summary.receivablesAmount).toBe(60);
  });
});
