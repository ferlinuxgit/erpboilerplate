import { describe, expect, it } from "vitest";

import { assessReadiness, selectSafeToPost, type ReviewItem, type ReviewLine } from "./expense-review";

const line = (patch: Partial<ReviewLine> = {}): ReviewLine => ({
  description: "Luz de marzo",
  expenseAccountId: "acc-628",
  accountSource: "ocr",
  quantity: "1",
  unitPrice: "100",
  taxRate: "21",
  taxDeductiblePct: "100",
  retentionRate: "0",
  ...patch,
});

const item = (patch: Partial<ReviewItem> = {}): ReviewItem => ({
  status: "DONE",
  confidence: "high",
  warnings: [],
  duplicateLevel: "none",
  acknowledgeBlocking: false,
  reviewed: false,
  supplierPartnerId: "sup-1",
  supplierName: "",
  supplierTaxId: "",
  supplierDocumentNumber: "F-1",
  issueDate: "2026-09-01",
  currencyCode: "EUR",
  extractedTotal: 121,
  lines: [line()],
  ...patch,
});

describe("assessReadiness", () => {
  it("accepts a well-read document whose accounts come from the reading or the supplier", () => {
    expect(assessReadiness(item(), "EUR")).toEqual({ ready: true, reasons: [], total: 121 });
    expect(assessReadiness(item({ lines: [line({ accountSource: "supplier" })] }), "EUR").ready).toBe(true);
    expect(assessReadiness(item({ lines: [line({ accountSource: "user" })] }), "EUR").ready).toBe(true);
  });

  it("flags 'Revisar cuenta' when a line has no proposed or chosen account", () => {
    const readiness = assessReadiness(item({ lines: [line(), line({ expenseAccountId: "", accountSource: "none", unitPrice: "0" })] }), "EUR");
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("account");
  });

  it("requires a manual review for medium or low confidence readings", () => {
    expect(assessReadiness(item({ confidence: "medium" }), "EUR").reasons).toEqual(["confidence"]);
    expect(assessReadiness(item({ confidence: "medium", reviewed: true }), "EUR").ready).toBe(true);
  });

  it("blocks duplicates, unacknowledged blocking warnings, totals mismatches and foreign currency", () => {
    expect(assessReadiness(item({ duplicateLevel: "possible" }), "EUR").reasons).toContain("duplicate");
    expect(assessReadiness(item({ warnings: ["Bloqueo: NIF inválido"] }), "EUR").reasons).toContain("blocking");
    expect(assessReadiness(item({ warnings: ["Bloqueo: NIF inválido"], acknowledgeBlocking: true }), "EUR").ready).toBe(true);
    expect(assessReadiness(item({ extractedTotal: 150 }), "EUR").reasons).toContain("totals");
    expect(assessReadiness(item({ currencyCode: "USD" }), "EUR").reasons).toContain("currency");
    expect(assessReadiness(item({ supplierDocumentNumber: " " }), "EUR").reasons).toContain("number");
    expect(assessReadiness(item({ supplierPartnerId: "" }), "EUR").reasons).toContain("supplier");
  });

  it("is never ready while not in review state", () => {
    expect(assessReadiness(item({ status: "POSTED" }), "EUR").ready).toBe(false);
  });
});

describe("selectSafeToPost", () => {
  it("returns only safe documents and the amount to confirm", () => {
    const items = [
      { ...item(), id: "a" },
      { ...item({ lines: [line({ expenseAccountId: "", accountSource: "none" })] }), id: "b" },
      { ...item({ confidence: "low" }), id: "c" },
      { ...item({ extractedTotal: 60.5, lines: [line({ unitPrice: "50" })] }), id: "d" },
    ];
    const selection = selectSafeToPost(items, "EUR");
    expect(selection.ready.map((entry) => entry.item.id)).toEqual(["a", "d"]);
    expect(selection.total).toBe(181.5);
  });
});
