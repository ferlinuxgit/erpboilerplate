import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { bankTransaction, customer, fiscalYear, invoice, partner, payment, supplierInvoice, supplierPayment } from "@/db/schema";
import type { DbClient } from "@/lib/db";

/**
 * Datos de los documentos de origen que enriquecen los apuntes automáticos: concepto legible
 * («Fra. FA-2026/000049 · Pérez S.L.»), tercero, documento y vencimiento. Se usan al contabilizar
 * y en la reclasificación de los asientos antiguos, así que el texto es idéntico en ambos casos.
 */

const CONCEPT_MAX_LENGTH = 200;

export type LineDocument = {
  concept: string;
  partnerId: string | null;
  documentType: string | null;
  documentNumber: string | null;
  documentId: string | null;
  /** Vencimiento del documento: solo se guarda en los apuntes del tercero (430/400/410). */
  dueDate: Date | null;
};

function clip(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > CONCEPT_MAX_LENGTH ? `${trimmed.slice(0, CONCEPT_MAX_LENGTH - 1)}…` : trimmed;
}

function withParty(text: string, partyName: string | null | undefined) {
  return clip(partyName?.trim() ? `${text} · ${partyName.trim()}` : text);
}

export function salesInvoiceConcept(input: { number: string; partyName: string | null }) {
  return withParty(`Fra. ${input.number}`, input.partyName);
}

export function creditNoteConcept(input: { number: string; originalNumber: string | null; partyName: string | null }) {
  return withParty(input.originalNumber ? `Rect. ${input.number} s/ fra. ${input.originalNumber}` : `Rect. ${input.number}`, input.partyName);
}

export function customerPaymentConcept(input: { invoiceNumber: string; partyName: string | null }) {
  return withParty(`Cobro fra. ${input.invoiceNumber}`, input.partyName);
}

export function supplierInvoiceConcept(input: { documentNumber: string; partyName: string | null }) {
  return withParty(`Fra. prov. ${input.documentNumber}`, input.partyName);
}

export function supplierPaymentConcept(input: { invoiceDocumentNumber: string | null; partyName: string | null }) {
  return withParty(input.invoiceDocumentNumber ? `Pago fra. ${input.invoiceDocumentNumber}` : "Pago a cuenta", input.partyName);
}

export function bankMovementConcept(description: string | null | undefined) {
  return clip(description?.trim() ? `Mov. banco · ${description.trim()}` : "Movimiento bancario");
}

export function reversalConcept(concept: string | null | undefined, fallback: string) {
  return clip(`Anulación · ${concept?.trim() || fallback}`);
}

export type InvoicePostingContext = {
  invoiceId: string;
  number: string;
  invoiceType: string;
  originalNumber: string | null;
  dueDate: Date | null;
  partnerId: string | null;
  partyName: string | null;
};

export async function loadInvoicePostingContext(client: DbClient, companyId: string, invoiceId: string): Promise<InvoicePostingContext | null> {
  const original = alias(invoice, "original_invoice");
  const [row] = await client
    .select({
      number: invoice.number,
      invoiceType: invoice.invoiceType,
      originalNumber: original.number,
      dueDate: invoice.dueDate,
      partnerId: customer.partnerId,
      partnerName: partner.name,
      customerName: customer.name,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .leftJoin(original, eq(original.id, invoice.rectifiedInvoiceId))
    .where(and(eq(invoice.companyId, companyId), eq(invoice.id, invoiceId)))
    .limit(1);
  if (!row) return null;
  return {
    invoiceId,
    number: row.number,
    invoiceType: row.invoiceType,
    originalNumber: row.originalNumber ?? null,
    dueDate: row.dueDate ?? null,
    partnerId: row.partnerId ?? null,
    partyName: row.partnerName ?? row.customerName ?? null,
  };
}

export function invoiceLineDocument(context: InvoicePostingContext): LineDocument {
  return {
    concept: context.invoiceType === "CREDIT_NOTE"
      ? creditNoteConcept({ number: context.number, originalNumber: context.originalNumber, partyName: context.partyName })
      : salesInvoiceConcept({ number: context.number, partyName: context.partyName }),
    partnerId: context.partnerId,
    documentType: "invoice",
    documentNumber: context.number,
    documentId: context.invoiceId,
    dueDate: context.dueDate,
  };
}

export type SupplierInvoicePostingContext = {
  supplierInvoiceId: string;
  number: string;
  documentNumber: string;
  dueDate: Date | null;
  partnerId: string;
  partyName: string | null;
};

export async function loadSupplierInvoicePostingContext(
  client: DbClient,
  companyId: string,
  supplierInvoiceId: string,
): Promise<SupplierInvoicePostingContext | null> {
  const [row] = await client
    .select({
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      dueDate: supplierInvoice.dueDate,
      partnerId: supplierInvoice.supplierPartnerId,
      partnerName: partner.name,
    })
    .from(supplierInvoice)
    .leftJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, supplierInvoiceId)))
    .limit(1);
  if (!row) return null;
  return {
    supplierInvoiceId,
    number: row.number,
    documentNumber: row.supplierDocumentNumber?.trim() || row.number,
    dueDate: row.dueDate ?? null,
    partnerId: row.partnerId,
    partyName: row.partnerName ?? null,
  };
}

export function supplierInvoiceLineDocument(context: SupplierInvoicePostingContext): LineDocument {
  return {
    concept: supplierInvoiceConcept({ documentNumber: context.documentNumber, partyName: context.partyName }),
    partnerId: context.partnerId,
    documentType: "supplierInvoice",
    documentNumber: context.documentNumber,
    documentId: context.supplierInvoiceId,
    dueDate: context.dueDate,
  };
}

export type CustomerPaymentPostingContext = InvoicePostingContext & { paymentId: string; paymentNumber: string };

export async function loadCustomerPaymentPostingContext(
  client: DbClient,
  companyId: string,
  paymentId: string,
): Promise<CustomerPaymentPostingContext | null> {
  const [row] = await client
    .select({ number: payment.number, invoiceId: payment.invoiceId })
    .from(payment)
    .where(and(eq(payment.companyId, companyId), eq(payment.id, paymentId)))
    .limit(1);
  if (!row) return null;
  const invoiceContext = await loadInvoicePostingContext(client, companyId, row.invoiceId);
  if (!invoiceContext) return null;
  return { ...invoiceContext, paymentId, paymentNumber: row.number };
}

export function customerPaymentLineDocument(context: CustomerPaymentPostingContext): LineDocument {
  return {
    concept: customerPaymentConcept({ invoiceNumber: context.number, partyName: context.partyName }),
    partnerId: context.partnerId,
    documentType: "invoice",
    documentNumber: context.number,
    documentId: context.invoiceId,
    dueDate: context.dueDate,
  };
}

export type SupplierPaymentPostingContext = {
  supplierPaymentId: string;
  paymentNumber: string;
  partnerId: string;
  partyName: string | null;
  invoice: SupplierInvoicePostingContext | null;
};

export async function loadSupplierPaymentPostingContext(
  client: DbClient,
  companyId: string,
  supplierPaymentId: string,
): Promise<SupplierPaymentPostingContext | null> {
  const [row] = await client
    .select({
      number: supplierPayment.number,
      partnerId: supplierPayment.supplierPartnerId,
      partnerName: partner.name,
      supplierInvoiceId: supplierPayment.supplierInvoiceId,
    })
    .from(supplierPayment)
    .leftJoin(partner, eq(partner.id, supplierPayment.supplierPartnerId))
    .where(and(eq(supplierPayment.companyId, companyId), eq(supplierPayment.id, supplierPaymentId)))
    .limit(1);
  if (!row) return null;
  const invoiceContext = row.supplierInvoiceId ? await loadSupplierInvoicePostingContext(client, companyId, row.supplierInvoiceId) : null;
  return {
    supplierPaymentId,
    paymentNumber: row.number,
    partnerId: row.partnerId,
    partyName: row.partnerName ?? null,
    invoice: invoiceContext,
  };
}

export function supplierPaymentLineDocument(context: SupplierPaymentPostingContext): LineDocument {
  const concept = supplierPaymentConcept({ invoiceDocumentNumber: context.invoice?.documentNumber ?? null, partyName: context.partyName });
  if (context.invoice) {
    return {
      concept,
      partnerId: context.partnerId,
      documentType: "supplierInvoice",
      documentNumber: context.invoice.documentNumber,
      documentId: context.invoice.supplierInvoiceId,
      dueDate: context.invoice.dueDate,
    };
  }
  return {
    concept,
    partnerId: context.partnerId,
    documentType: "supplierPayment",
    documentNumber: context.paymentNumber,
    documentId: context.supplierPaymentId,
    dueDate: null,
  };
}

export async function loadBankTransactionLineDocument(client: DbClient, bankTransactionId: string): Promise<LineDocument | null> {
  const [row] = await client
    .select({ description: bankTransaction.description, reference: bankTransaction.reference })
    .from(bankTransaction)
    .where(eq(bankTransaction.id, bankTransactionId))
    .limit(1);
  if (!row) return null;
  return {
    concept: bankMovementConcept(row.description),
    partnerId: null,
    documentType: "bankTransaction",
    documentNumber: row.reference?.trim() || null,
    documentId: bankTransactionId,
    dueDate: null,
  };
}

export async function loadFiscalYearLineDocument(client: DbClient, companyId: string, fiscalYearId: string, concept: string): Promise<LineDocument> {
  const [row] = await client
    .select({ code: fiscalYear.code })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.companyId, companyId), eq(fiscalYear.id, fiscalYearId)))
    .limit(1);
  return { concept: clip(concept), partnerId: null, documentType: "fiscalYear", documentNumber: row?.code ?? null, documentId: fiscalYearId, dueDate: null };
}
