/** Documento de origen de un apunte contable: etiqueta y enlace a su ficha (si la tiene). */

const DOCUMENT_LABELS: Record<string, string> = {
  invoice: "Factura",
  supplierInvoice: "Fra. proveedor",
  payment: "Cobro",
  supplierPayment: "Pago",
  bankTransaction: "Mov. banco",
  fiscalYear: "Ejercicio",
};

export function accountingDocumentLabel(documentType: string | null | undefined) {
  return documentType ? DOCUMENT_LABELS[documentType] ?? "Documento" : null;
}

export function accountingDocumentHref(documentType: string | null | undefined, documentId: string | null | undefined) {
  if (!documentType || !documentId) return null;
  if (documentType === "invoice") return `/invoices/${documentId}`;
  if (documentType === "supplierInvoice") return `/expenses/${documentId}`;
  if (documentType === "bankTransaction") return `/treasury/bank-transactions/${documentId}`;
  return null;
}
