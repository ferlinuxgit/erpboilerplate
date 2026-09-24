import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildSupplierInvoiceLines, normalizePostingLines } from "@/server/accounting/auto-post";
import { buildModelo303Boxes, computeIssuedVat, computeModelo303Totals, computeSupplierVat, type IssuedLineInput, type SupplierLineInput } from "@/server/fiscal/spain-calc";
import { issuedInvoiceFiscalFilter, supplierInvoiceFiscalFilter } from "@/server/fiscal/spain";

vi.mock("@/server/audit", () => ({ recordAudit: vi.fn() }));

const issueDate = new Date(Date.UTC(2026, 3, 10));

function issued(overrides: Partial<IssuedLineInput>): IssuedLineInput {
  return { invoiceId: "inv-1", number: "F-1", issueDate, totalAmount: 121, treatment: "DOMESTIC", quantity: 1, unitPrice: 100, taxRate: 21, ...overrides };
}

function received(overrides: Partial<SupplierLineInput>): SupplierLineInput {
  return { invoiceId: "sup-1", number: "P-1", issueDate, totalAmount: 121, treatment: "DOMESTIC", subtotal: 100, taxAmount: 21, taxRate: 21, taxDeductiblePct: 100, ...overrides };
}

function box(boxes: ReturnType<typeof buildModelo303Boxes>, code: string) {
  return boxes.find((entry) => entry.box === code)?.amount;
}

describe("Modelo 303 computation", () => {
  it("fills 4/5/10/21 buckets with their current AEAT boxes", () => {
    const result = computeIssuedVat([
      issued({ invoiceId: "a", unitPrice: 100, taxRate: 4 }),
      issued({ invoiceId: "b", unitPrice: 100, taxRate: 5 }),
      issued({ invoiceId: "c", unitPrice: 100, taxRate: 10 }),
      issued({ invoiceId: "d", unitPrice: 100, taxRate: 21 }),
    ]);
    const boxes = buildModelo303Boxes(result, computeSupplierVat([], 100), { periodYear: 2026 });
    expect([box(boxes, "01"), box(boxes, "03"), box(boxes, "153"), box(boxes, "155"), box(boxes, "04"), box(boxes, "06"), box(boxes, "07"), box(boxes, "09")]).toEqual([100, 4, 100, 5, 100, 10, 100, 21]);
    expect(box(boxes, "27")).toBe(40);
  });

  it("puts recargo de equivalencia in its own boxes and in the accrued total (reconciles with 477)", () => {
    const result = computeIssuedVat([issued({
      taxes: [
        { rate: 21, kind: "VAT", operation: "ADD", baseAmount: "100.00", amount: "21.00" },
        { rate: 5.2, kind: "SURCHARGE", operation: "ADD", baseAmount: "100.00", amount: "5.20" },
      ],
    })]);
    const supplier = computeSupplierVat([], 100);
    const boxes = buildModelo303Boxes(result, supplier, { periodYear: 2026 });
    expect(box(boxes, "22")).toBe(100);
    expect(box(boxes, "24")).toBe(5.2);
    // 477 recibe 21 + 5,20 del asiento de la factura.
    expect(computeModelo303Totals(result, supplier).accruedCents).toBe(2620);
  });

  it("self-assesses intra-EU acquisitions (10/11 and 36/37) and reverse charge (12/13 and 28/29) so the net effect is zero", () => {
    const supplier = computeSupplierVat([
      received({ invoiceId: "eu", treatment: "INTRA_EU", subtotal: 1000, taxAmount: 0, taxRate: 0 }),
      received({ invoiceId: "isp", treatment: "REVERSE_CHARGE", subtotal: 500, taxAmount: 0, taxRate: 0 }),
    ], 100);
    const boxes = buildModelo303Boxes(computeIssuedVat([]), supplier, { periodYear: 2026 });
    expect([box(boxes, "10"), box(boxes, "11"), box(boxes, "12"), box(boxes, "13")]).toEqual([1000, 210, 500, 105]);
    expect([box(boxes, "36"), box(boxes, "37"), box(boxes, "28"), box(boxes, "29")]).toEqual([1000, 210, 500, 105]);
    expect(box(boxes, "46")).toBe(0);
    expect(supplier.defaultRateLines).toBe(2);
  });

  it("applies line deductibility and prorrata exactly like the accounting entry (472)", () => {
    const lines = [
      received({ invoiceId: "x", subtotal: 5.15, taxAmount: 1.08, taxDeductiblePct: 33 }),
      received({ invoiceId: "x", subtotal: 7.35, taxAmount: 1.54, taxDeductiblePct: 33 }),
    ];
    const supplier = computeSupplierVat(lines, 80);
    const posted = normalizePostingLines(buildSupplierInvoiceLines({
      accounts: { purchase: "600", supplier: "400", vatInput: "472", vatOutput: "477", withholdingPayable: "4751" },
      expenseLines: lines.map((line) => ({ accountId: "600", subtotal: Number(line.subtotal), taxAmount: Number(line.taxAmount), taxDeductiblePct: Number(line.taxDeductiblePct) })),
      totalAmount: 15.12,
      prorrataPct: 80,
      vatTreatment: "DOMESTIC",
    }));
    const posted472 = posted.find((line) => line.accountId === "472")?.debit;
    expect(supplier.deductibleCents).toBe(Math.round(Number(posted472) * 100));
    const boxes = buildModelo303Boxes(computeIssuedVat([]), supplier, { periodYear: 2026 });
    expect(box(boxes, "29")).toBe(Number(posted472));
  });

  it("splits withholdings practiced into 111 (professionals) and 115 (rent, account 621)", () => {
    const supplier = computeSupplierVat([
      received({ invoiceId: "lawyer", retentionAmount: 15, retentionRate: 15, expenseAccountCode: "623" }),
      received({ invoiceId: "rent", subtotal: 1000, taxAmount: 210, retentionAmount: 190, retentionRate: 19, expenseAccountCode: "621" }),
    ], 100);
    expect([...supplier.professional.values()]).toEqual([{ rate: 15, base: 10000, tax: 1500 }]);
    expect([...supplier.rent.values()]).toEqual([{ rate: 19, base: 100000, tax: 19000 }]);
  });

  it("collects withholdings suffered on sales separately (account 473)", () => {
    const result = computeIssuedVat([issued({ retentionRate: 15 })]);
    expect([...result.withholdings.values()]).toEqual([{ rate: 15, base: 10000, tax: 1500 }]);
  });

  it("reports intra-EU deliveries, exports and exempt operations as informative boxes", () => {
    const result = computeIssuedVat([
      issued({ invoiceId: "eu", treatment: "INTRA_EU", taxRate: 0, unitPrice: 300 }),
      issued({ invoiceId: "ex", treatment: "EXPORT", taxRate: 0, unitPrice: 200 }),
      issued({ invoiceId: "zero", treatment: "DOMESTIC", taxRate: 0, unitPrice: 50 }),
    ]);
    const supplier = computeSupplierVat([], 100);
    const boxes2026 = buildModelo303Boxes(result, supplier, { periodYear: 2026 });
    expect([box(boxes2026, "59"), box(boxes2026, "60"), box(boxes2026, "EXE"), box(boxes2026, "150")]).toEqual([300, 200, 50, undefined]);
    const boxes2024 = buildModelo303Boxes(result, supplier, { periodYear: 2024 });
    expect(box(boxes2024, "150")).toBe(50);
  });

  it("counts draft invoices so the user is warned", () => {
    expect(computeIssuedVat([issued({ status: "DRAFT" })]).draftInvoiceCount).toBe(1);
  });
});

describe("fiscal document scope", () => {
  const dialect = new PgDialect();
  const start = new Date(Date.UTC(2026, 0, 1));
  const end = new Date(Date.UTC(2026, 3, 1));

  it("excludes void and draft supplier invoices from 303/390/347", () => {
    const query = dialect.sqlToQuery(supplierInvoiceFiscalFilter("company-1", start, end)!);
    expect(query.sql).toContain("not in");
    expect(query.params).toEqual(expect.arrayContaining(["VOID", "DRAFT"]));
  });

  it("excludes void issued invoices", () => {
    const query = dialect.sqlToQuery(issuedInvoiceFiscalFilter("company-1", start, end)!);
    expect(query.sql).toContain("<>");
    expect(query.params).toContain("VOID");
  });
});
