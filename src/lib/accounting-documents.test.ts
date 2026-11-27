import { describe, expect, it } from "vitest";

import { accountingDocumentHref, accountingEntrySourceHref } from "@/lib/accounting-documents";

describe("enlace al documento de origen de un asiento", () => {
  it("enlaza directamente los orígenes cuya clave es el documento", () => {
    expect(accountingEntrySourceHref("invoice", "i-1")).toBe("/invoices/i-1");
    expect(accountingEntrySourceHref("supplierInvoice", "s-1")).toBe("/expenses/s-1");
    expect(accountingEntrySourceHref("bankTransaction", "b-1")).toBe("/treasury/bank-transactions/b-1");
    // La baja de un bien lleva el id del bien como origen.
    expect(accountingEntrySourceHref("fixedAssetDisposal", "a-1")).toBe("/accounting/assets/a-1");
  });

  it("la dotación (origen = fila de la dotación) enlaza con la ficha del bien por sus apuntes", () => {
    const lines = [{ documentType: null, documentId: null }, { documentType: "fixedAsset", documentId: "a-1" }];
    expect(accountingEntrySourceHref("fixedAssetDepreciation", "dep-1", lines)).toBe("/accounting/assets/a-1");
    expect(accountingEntrySourceHref("fixedAssetDepreciation", "dep-1", [])).toBeNull();
  });

  it("la devolución de un abono de proveedor enlaza con el abono", () => {
    expect(accountingEntrySourceHref("supplierCreditRefund", "app-1", [{ documentType: "supplierInvoice", documentId: "c-1" }])).toBe("/expenses/c-1");
  });

  it("un asiento manual o de origen desconocido no tiene enlace, aunque sus apuntes citen documentos", () => {
    expect(accountingEntrySourceHref(null, null, [{ documentType: "invoice", documentId: "i-1" }])).toBeNull();
    expect(accountingEntrySourceHref("payment", "p-1")).toBeNull();
    expect(accountingDocumentHref("fixedAsset", "a-1")).toBe("/accounting/assets/a-1");
  });
});
