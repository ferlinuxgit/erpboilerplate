import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { resolveSupplierVatTreatment } from "@/lib/fiscal-spain";
import { computeIncomeTaxExpenseCents, computeSupplierVat, type SupplierLineInput } from "@/server/fiscal/spain-calc";
import { computeSupplierInvoiceAmounts, resolveAccountingDate } from "@/server/supplier-invoices/service";

function line(patch: Partial<SupplierLineInput> = {}): SupplierLineInput {
  return {
    invoiceId: "inv-1",
    number: "FP-1",
    issueDate: new Date("2026-02-10T12:00:00.000Z"),
    totalAmount: 121,
    treatment: "DOMESTIC",
    subtotal: 100,
    taxAmount: 21,
    taxRate: 21,
    taxDeductiblePct: 100,
    retentionAmount: 0,
    retentionRate: 0,
    expenseAccountCode: "62800000",
    ...patch,
  };
}

describe("supplier VAT rules", () => {
  it("defaults non-EU services to reverse charge and non-EU goods to import", () => {
    expect(resolveSupplierVatTreatment(null, "US", "SERVICES")).toBe("REVERSE_CHARGE");
    expect(resolveSupplierVatTreatment(null, "US", "GOODS")).toBe("IMPORT");
    expect(resolveSupplierVatTreatment(null, "US")).toBe("IMPORT");
    expect(resolveSupplierVatTreatment(null, "DE", "SERVICES")).toBe("INTRA_EU");
    expect(resolveSupplierVatTreatment("DOMESTIC", "US", "SERVICES")).toBe("DOMESTIC");
  });

  it("never charges VAT on a not-subject purchase", () => {
    const amounts = computeSupplierInvoiceAmounts([{ description: "Tasa", quantity: 1, unitPrice: 100, taxRate: 21 }], "NOT_SUBJECT");
    expect(amounts).toMatchObject({ subtotalAmount: 100, taxAmount: 0, totalAmount: 100 });
    expect(amounts.lines[0].taxRate).toBe(0);
  });

  it("uses the prorrata stored on each invoice instead of today's", () => {
    const result = computeSupplierVat([line({ prorrataPct: 50 }), line({ invoiceId: "inv-2", number: "FP-2" })], 100);
    // 21 × 50 % + 21 × 100 %.
    expect(result.deductibleCents).toBe(1050 + 2100);
    expect(computeIncomeTaxExpenseCents([line({ prorrataPct: 50 })], 100)).toBe(10_000 + 1050);
  });

  it("subtracts a voided invoice in the period of its annulment and keeps both rows in the register", () => {
    const result = computeSupplierVat([
      line({ invoiceId: "inv-2", number: "FP-2", subtotal: 200, taxAmount: 42, totalAmount: 242 }),
      line({ sign: -1, prorrataPct: 80, retentionAmount: 15, retentionRate: 15 }),
    ], 100);
    // +42 de FP-2, −21 × 80 % de la anulación de FP-1.
    expect(result.deductibleCents).toBe(4200 - 1680);
    expect(result.totalTaxCents).toBe(4200 - 2100);
    const annulment = result.documents.find((document) => document.id === "inv-1:anulacion");
    expect(annulment).toMatchObject({ sourceId: "inv-1", number: "FP-1 (anulación)", taxBase: -100, taxAmount: -16.8, chargedTaxAmount: -21, withholdingAmount: -15, totalAmount: -121 });
    expect([...result.invoiceIds].sort()).toEqual(["inv-1", "inv-2"]);
  });

  it("an invoice and its annulment in the same period cancel out", () => {
    const result = computeSupplierVat([line(), line({ sign: -1 })], 100);
    expect(result.deductibleCents).toBe(0);
    expect(result.totalTaxCents).toBe(0);
  });

  it("reports the registration date of a late invoice", () => {
    const result = computeSupplierVat([line({ accountingDate: new Date("2026-04-05T12:00:00.000Z") })], 100);
    expect(result.documents[0]).toMatchObject({ issueDate: "2026-02-10T12:00:00.000Z", registrationDate: "2026-04-05T12:00:00.000Z" });
  });
});

describe("registration date", () => {
  const issueDate = new Date("2026-02-10T12:00:00.000Z");

  it("defaults to the invoice date", () => {
    expect(resolveAccountingDate(issueDate, undefined)).toBe(issueDate);
  });

  it("accepts a later date and rejects an earlier one or one past the 4-year limit", () => {
    expect(resolveAccountingDate(issueDate, new Date("2026-04-05T12:00:00.000Z")).toISOString()).toBe("2026-04-05T12:00:00.000Z");
    expect(() => resolveAccountingDate(issueDate, new Date("2026-02-09T12:00:00.000Z"))).toThrow(/anterior/);
    expect(() => resolveAccountingDate(issueDate, new Date("2030-03-01T12:00:00.000Z"))).toThrow(/4 años/);
  });
});
