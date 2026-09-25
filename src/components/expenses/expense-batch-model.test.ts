import { describe, expect, it } from "vitest";

import { applySupplierToItem, hydrateItem, itemFromInboxJob, newBatchItem, type BatchSupplier, type OcrDraft } from "./expense-batch-model";

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
