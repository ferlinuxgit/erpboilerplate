import { describe, expect, it } from "vitest";

import { reviewDocumentTotal } from "./expense-review";

import { applySupplierToItem, applyTaxSummaryLines, groupItemLines, hydrateItem, itemFromInboxJob, newBatchItem, type BatchSupplier, type OcrDraft } from "./expense-batch-model";

const expenseAccounts = [
  { id: "acc-600", code: "600", name: "Compras de mercaderías" },
  { id: "acc-628", code: "628", name: "Suministros" },
  { id: "acc-623", code: "623", name: "Servicios de profesionales independientes" },
];

const supplier: BatchSupplier = {
  id: "sup-1",
  number: "P-1",
  name: "Asesoría López",
  taxId: "B12345674",
  defaults: { defaultExpenseAccountId: "acc-623", defaultRetentionRate: 15, defaultTaxDeductiblePct: null, defaultVatTreatment: null, paymentTermsDays: 30 },
};

const draft = (patch: Partial<OcrDraft> = {}): OcrDraft => ({
  supplierName: "Proveedor",
  supplierTaxId: "B99999999",
  supplierDocumentNumber: "F-1",
  issueDate: "2026-09-01T12:00:00.000Z",
  totalAmount: 121,
  lines: [{ description: "Servicio", quantity: 1, unitPrice: 100, taxRate: 21, taxDeductiblePct: 100, retentionRate: 0 }],
  confidence: "high",
  warnings: [],
  ...patch,
});

const context = { expenseAccounts, suppliers: [supplier] };
const base = () => newBatchItem({ fileName: "f.pdf", sizeBytes: 1, contentType: "application/pdf", status: "PENDING" });

describe("hydrateItem", () => {
  it("never picks the first account of the chart silently", () => {
    const hydrated = hydrateItem(base(), draft(), { level: "none", matches: [] }, context);
    expect(hydrated.lines[0]).toMatchObject({ expenseAccountId: "", accountSource: "none" });
  });

  it("uses the account suggested by the reading", () => {
    const hydrated = hydrateItem({ ...base(), provider: "openai" }, draft({ lines: [{ ...draft().lines[0], suggestedExpenseAccountCode: "628" }] }), { level: "none", matches: [] }, context);
    expect(hydrated.lines[0]).toMatchObject({ expenseAccountId: "acc-628", accountSource: "ai" });
  });

  it("applies the defaults of the supplier matched by tax id (account, IRPF, due date)", () => {
    const hydrated = hydrateItem(base(), draft({ supplierTaxId: "B-12345674", lines: [{ ...draft().lines[0] }] }), { level: "none", matches: [] }, context);
    expect(hydrated.supplierPartnerId).toBe("sup-1");
    expect(hydrated.lines[0]).toMatchObject({ expenseAccountId: "acc-623", accountSource: "supplier", retentionRate: "15" });
    expect(hydrated.dueDate).toBe("2026-10-01");
  });

  it("keeps the due date printed on the document", () => {
    const hydrated = hydrateItem(base(), draft({ supplierTaxId: "B12345674", dueDate: "2026-09-15T12:00:00.000Z" }), { level: "none", matches: [] }, context);
    expect(hydrated.dueDate).toBe("2026-09-15");
  });

  it("leaves the issue date empty when it was not read instead of using today", () => {
    const hydrated = hydrateItem(base(), draft({ issueDate: undefined }), { level: "none", matches: [] }, context);
    expect(hydrated.issueDate).toBe("");
  });
});

describe("applySupplierToItem", () => {
  it("does not override a due date typed by the user", () => {
    const item = { ...hydrateItem(base(), draft(), { level: "none", matches: [] }, context), dueDate: "2026-12-31", dueDateEdited: true };
    expect(applySupplierToItem(item, supplier).dueDate).toBe("2026-12-31");
  });
});

describe("itemFromInboxJob", () => {
  it("restores a pending document with a stable id and its stored file", () => {
    const item = itemFromInboxJob({
      id: "job-1",
      batchId: "batch-1",
      status: "PROCESSING",
      fileName: "ticket.jpg",
      fileUrl: null,
      contentType: "image/jpeg",
      sizeBytes: 10,
      extractionProvider: null,
      errorMessage: null,
      extracted: null,
      duplicateAssessment: { level: "none", matches: [] },
    }, context);
    expect(item).toMatchObject({ localId: "job-1", jobId: "job-1", batchId: "batch-1", status: "PROCESSING", fileUrl: "/api/expenses/ocr/job-1/file" });
  });
});

describe("invoices with many lines", () => {
  const manyLines = draft({
    totalAmount: 352,
    lines: [
      { description: "Pienso", quantity: 2, unitPrice: 50, taxRate: 21, taxDeductiblePct: 100, retentionRate: 0, suggestedExpenseAccountCode: "600" },
      { description: "Correa", quantity: 1, unitPrice: 100, taxRate: 21, taxDeductiblePct: 100, retentionRate: 0, suggestedExpenseAccountCode: "600" },
      { description: "Fruta", quantity: 4, unitPrice: 25, taxRate: 10, taxDeductiblePct: 100, retentionRate: 0, suggestedExpenseAccountCode: "600" },
    ],
    taxSummary: [{ taxRate: 21, base: 200, taxDeductiblePct: 100 }, { taxRate: 10, base: 100, taxDeductiblePct: 100 }],
  });

  it("groups lines with the same account and rates without changing the total", () => {
    const hydrated = hydrateItem(base(), manyLines, { level: "none", matches: [] }, context);
    const grouped = groupItemLines(hydrated);
    expect(grouped.lines).toHaveLength(2);
    expect(grouped.lines[0]).toMatchObject({ description: "Pienso y 1 concepto más", quantity: "1", unitPrice: "200,00", expenseAccountId: "acc-600" });
    expect(reviewDocumentTotal(grouped.lines)).toBe(reviewDocumentTotal(hydrated.lines));
    expect(reviewDocumentTotal(grouped.lines)).toBe(352);
  });

  it("replaces the lines with one per VAT rate from the invoice summary, keeping the account", () => {
    const hydrated = hydrateItem(base(), { ...manyLines, lines: manyLines.lines.slice(0, 1) }, { level: "none", matches: [] }, context);
    const summarised = applyTaxSummaryLines(hydrated);
    expect(summarised.lines.map((line) => [line.unitPrice, line.taxRate, line.expenseAccountId])).toEqual([["200,00", "21", "acc-600"], ["100,00", "10", "acc-600"]]);
    expect(reviewDocumentTotal(summarised.lines)).toBe(352);
  });

  it("computes the document total with VAT per rate, like the server", () => {
    const lines = Array.from({ length: 30 }, () => ({ quantity: "1", unitPrice: "0,33", taxRate: "21", retentionRate: "0" }));
    expect(reviewDocumentTotal(lines)).toBe(11.98);
  });
});
