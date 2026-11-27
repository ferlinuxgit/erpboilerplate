/** Documento de origen de un apunte contable: etiqueta y enlace a su ficha (si la tiene). */

const DOCUMENT_LABELS: Record<string, string> = {
  invoice: "Factura",
  supplierInvoice: "Fra. proveedor",
  payment: "Cobro",
  supplierPayment: "Pago",
  bankTransaction: "Mov. banco",
  fiscalYear: "Ejercicio",
  fixedAsset: "Inmovilizado",
};

export function accountingDocumentLabel(documentType: string | null | undefined) {
  return documentType ? DOCUMENT_LABELS[documentType] ?? "Documento" : null;
}

export function accountingDocumentHref(documentType: string | null | undefined, documentId: string | null | undefined) {
  if (!documentType || !documentId) return null;
  if (documentType === "invoice") return `/invoices/${documentId}`;
  if (documentType === "supplierInvoice") return `/expenses/${documentId}`;
  if (documentType === "fixedAsset") return `/accounting/assets/${documentId}`;
  if (documentType === "bankTransaction") return `/treasury/bank-transactions/${documentId}`;
  return null;
}

/**
 * Enlace «Ver documento origen» de un asiento. Los orígenes cuya clave es el propio documento
 * (factura, factura de proveedor, movimiento, baja de un bien) se enlazan directamente; el resto
 * (dotación a la amortización, devolución de un abono de proveedor…) lleva el documento en sus
 * apuntes, así que se usa el primero que tenga ficha.
 */
export function accountingEntrySourceHref(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
  lines: ReadonlyArray<{ documentType?: string | null; documentId?: string | null }> = [],
) {
  if (sourceId) {
    if (sourceType === "invoice") return `/invoices/${sourceId}`;
    if (sourceType === "supplierInvoice") return `/expenses/${sourceId}`;
    if (sourceType === "bankTransaction") return `/treasury/bank-transactions/${sourceId}`;
    if (sourceType === "fixedAssetDisposal") return `/accounting/assets/${sourceId}`;
  }
  if (sourceType === "fixedAssetDepreciation" || sourceType === "supplierCreditRefund") {
    for (const line of lines) {
      const href = accountingDocumentHref(line.documentType, line.documentId);
      if (href) return href;
    }
  }
  return null;
}
