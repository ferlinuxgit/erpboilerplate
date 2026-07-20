import { and, eq } from "drizzle-orm";

import { company, customer, deliveryNote, deliveryNoteLine, partner, salesOrder, salesOrderLine, salesQuote, salesQuoteLine } from "@/db/schema";
import { db } from "@/lib/db";
import { salesDocumentStatusLabels, statusLabel } from "@/lib/status-labels";
import type { InvoicePdfInput } from "@/server/pdf/render";

const issuerFields = {
  companyName: company.name,
  companyLegalName: company.legalName,
  companyVatNumber: company.vatNumber,
  companyFiscalAddress: company.fiscalAddress,
  companyFiscalAddressLine2: company.fiscalAddressLine2,
  companyPostalCode: company.postalCode,
  companyCity: company.city,
  companyProvince: company.province,
  companyCountryCode: company.countryCode,
  companyEmail: company.email,
  companyPhone: company.phone,
  companyWebsite: company.website,
  companyLogoDataUrl: company.logoDataUrl,
  companyInvoiceFooter: company.invoiceFooter,
  currency: company.baseCurrencyCode,
  customerName: customer.name,
  customerTaxId: partner.taxId,
  customerAddress: partner.address,
  customerAddressLine2: partner.addressLine2,
  customerPostalCode: partner.postalCode,
  customerCity: partner.city,
  customerProvince: partner.province,
  customerCountryCode: partner.countryCode,
};

type PartyRow = {
  companyName: string;
  companyLegalName: string | null;
  companyVatNumber: string | null;
  companyFiscalAddress: string | null;
  companyFiscalAddressLine2: string | null;
  companyPostalCode: string | null;
  companyCity: string | null;
  companyProvince: string | null;
  companyCountryCode: string;
  companyEmail: string | null;
  companyPhone: string | null;
  companyWebsite: string | null;
  companyLogoDataUrl: string | null;
  companyInvoiceFooter: string | null;
  currency: string;
  customerName: string;
  customerTaxId: string | null;
  customerAddress: string | null;
  customerAddressLine2: string | null;
  customerPostalCode: string | null;
  customerCity: string | null;
  customerProvince: string | null;
  customerCountryCode: string | null;
};

type MoneyLine = { description: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string };

function date(value: Date | null) {
  return value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short" }).format(value) : null;
}

function money(value: number | string, currency: string) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(Number(value) || 0);
}

function decimal(value: number | string) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

function partyInput(row: PartyRow) {
  return {
    company: {
      name: row.companyName,
      legalName: row.companyLegalName,
      vatNumber: row.companyVatNumber,
      fiscalAddress: row.companyFiscalAddress,
      fiscalAddressLine2: row.companyFiscalAddressLine2,
      postalCode: row.companyPostalCode,
      city: row.companyCity,
      province: row.companyProvince,
      countryCode: row.companyCountryCode,
      email: row.companyEmail,
      phone: row.companyPhone,
      website: row.companyWebsite,
      logoDataUrl: row.companyLogoDataUrl,
      invoiceFooter: row.companyInvoiceFooter,
    },
    customer: {
      name: row.customerName,
      taxId: row.customerTaxId,
      address: row.customerAddress,
      addressLine2: row.customerAddressLine2,
      postalCode: row.customerPostalCode,
      city: row.customerCity,
      province: row.customerProvince,
      countryCode: row.customerCountryCode,
    },
  };
}

function financialInput(row: PartyRow & { number: string; issueDate: Date; dueDate: Date | null; subtotal: string; taxAmount: string; retentionAmount: string; totalAmount: string }, lines: MoneyLine[], documentTitle: string, dueDateLabel: string): InvoicePdfInput {
  return {
    ...partyInput(row),
    documentTitle,
    documentEyebrow: "Documento de venta",
    issueDate: date(row.issueDate)!,
    dueDate: date(row.dueDate),
    dueDateLabel,
    number: row.number,
    amount: money(row.totalAmount, row.currency),
    lines: lines.map((line) => ({ description: line.description, quantity: decimal(line.quantity), unitPrice: money(line.unitPrice, row.currency), taxRate: `${decimal(line.taxRate)}%`, lineTotal: money(line.lineTotal, row.currency) })),
    totals: {
      subtotal: money(row.subtotal, row.currency),
      taxAmount: money(row.taxAmount, row.currency),
      retentionAmount: money(row.retentionAmount, row.currency),
      hasRetention: Number(row.retentionAmount) > 0,
      totalAmount: money(row.totalAmount, row.currency),
    },
  };
}

export async function getSalesQuotePdfData(companyId: string, id: string) {
  const [row] = await db.select({ ...issuerFields, number: salesQuote.number, issueDate: salesQuote.issueDate, dueDate: salesQuote.validUntil, subtotal: salesQuote.subtotal, taxAmount: salesQuote.taxAmount, retentionAmount: salesQuote.retentionAmount, totalAmount: salesQuote.totalAmount })
    .from(salesQuote).innerJoin(company, eq(company.id, salesQuote.companyId)).innerJoin(customer, eq(customer.id, salesQuote.customerId)).leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(salesQuote.id, id), eq(salesQuote.companyId, companyId))).limit(1);
  if (!row) return null;
  const lines = await db.select({ description: salesQuoteLine.description, quantity: salesQuoteLine.quantity, unitPrice: salesQuoteLine.unitPrice, taxRate: salesQuoteLine.taxRate, lineTotal: salesQuoteLine.lineTotal }).from(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, id));
  return { filename: `presupuesto-${row.number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`, input: financialInput(row, lines, "Presupuesto", "Válido hasta") };
}

export async function getSalesOrderPdfData(companyId: string, id: string) {
  const [row] = await db.select({ ...issuerFields, number: salesOrder.number, issueDate: salesOrder.issueDate, status: salesOrder.status, subtotal: salesOrder.subtotal, taxAmount: salesOrder.taxAmount, retentionAmount: salesOrder.retentionAmount, totalAmount: salesOrder.totalAmount })
    .from(salesOrder).innerJoin(company, eq(company.id, salesOrder.companyId)).innerJoin(customer, eq(customer.id, salesOrder.customerId)).leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(salesOrder.id, id), eq(salesOrder.companyId, companyId))).limit(1);
  if (!row) return null;
  const lines = await db.select({ description: salesOrderLine.description, quantity: salesOrderLine.quantity, unitPrice: salesOrderLine.unitPrice, taxRate: salesOrderLine.taxRate, lineTotal: salesOrderLine.lineTotal }).from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, id));
  const input = financialInput({ ...row, dueDate: null }, lines, "Pedido", "Estado");
  input.dueDate = statusLabel(salesDocumentStatusLabels, row.status);
  return { filename: `pedido-venta-${row.number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`, input };
}

export async function getDeliveryNotePdfData(companyId: string, id: string) {
  const [row] = await db.select({ ...issuerFields, number: deliveryNote.number, issueDate: deliveryNote.issuedAt, status: deliveryNote.status })
    .from(deliveryNote).innerJoin(company, eq(company.id, deliveryNote.companyId)).innerJoin(customer, eq(customer.id, deliveryNote.customerId)).leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(deliveryNote.id, id), eq(deliveryNote.companyId, companyId))).limit(1);
  if (!row) return null;
  const lines = await db.select({ description: deliveryNoteLine.description, quantity: deliveryNoteLine.quantity }).from(deliveryNoteLine).where(eq(deliveryNoteLine.deliveryNoteId, id));
  const emptyMoney = money(0, row.currency);
  const input: InvoicePdfInput = {
    ...partyInput(row),
    documentTitle: "Albarán",
    documentEyebrow: "Documento de entrega",
    issueDateLabel: "Entrega",
    issueDate: date(row.issueDate)!,
    dueDateLabel: "Estado",
    dueDate: statusLabel(salesDocumentStatusLabels, row.status),
    summaryLabel: "Líneas",
    summaryValue: String(lines.length),
    showFinancials: false,
    number: row.number,
    amount: emptyMoney,
    lines: lines.map((line) => ({ description: line.description, quantity: decimal(line.quantity), unitPrice: emptyMoney, taxRate: "0%", lineTotal: emptyMoney })),
    totals: { subtotal: emptyMoney, taxAmount: emptyMoney, retentionAmount: emptyMoney, hasRetention: false, totalAmount: emptyMoney },
  };
  return { filename: `albaran-${row.number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`, input };
}
