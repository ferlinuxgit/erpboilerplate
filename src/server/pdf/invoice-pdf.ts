import { and, eq } from "drizzle-orm";

import { company, customer, invoice, invoiceLine, partner } from "@/db/schema";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { db } from "@/lib/db";
import type { InvoicePdfInput } from "@/server/pdf/render";

function formatDate(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short" }).format(value);
}

function formatMoney(value: number | string) {
  const numericValue = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number.isFinite(numericValue) ? numericValue : 0);
}

function formatDecimal(value: number | string, digits = 2) {
  const numericValue = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number.isFinite(numericValue) ? numericValue : 0);
}

function safeInvoiceFilename(number: string) {
  return `invoice-${number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;
}

export async function getInvoicePdfData(companyId: string, invoiceId: string): Promise<{ input: InvoicePdfInput; filename: string } | null> {
  const [row] = await db
    .select({
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      amount: invoice.totalAmount,
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
      companyInvoiceFooter: company.invoiceFooter,
      customerName: customer.name,
      customerTaxId: partner.taxId,
      customerAddress: partner.address,
      customerAddressLine2: partner.addressLine2,
      customerPostalCode: partner.postalCode,
      customerCity: partner.city,
      customerProvince: partner.province,
      customerCountryCode: partner.countryCode,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .innerJoin(company, eq(company.id, invoice.companyId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);

  if (!row) return null;

  const lines = await db
    .select({
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      taxRate: invoiceLine.taxRate,
      lineTotal: invoiceLine.lineTotal,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId));

  const totals = calculateInvoiceTotals(
    lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      taxRate: Number(line.taxRate),
    })),
  );

  return {
    filename: safeInvoiceFilename(row.number),
    input: {
      number: row.number,
      issueDate: formatDate(row.issueDate) ?? "",
      dueDate: formatDate(row.dueDate),
      amount: formatMoney(row.amount),
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
      lines: lines.map((line) => ({
        description: line.description,
        quantity: formatDecimal(line.quantity, 3),
        unitPrice: formatMoney(line.unitPrice),
        taxRate: `${formatDecimal(line.taxRate, 3)}%`,
        lineTotal: formatMoney(line.lineTotal),
      })),
      totals: {
        subtotal: formatMoney(totals.subtotal),
        taxAmount: formatMoney(totals.taxAmount),
        retentionAmount: formatMoney(totals.retentionAmount),
        hasRetention: totals.retentionAmount > 0,
        totalAmount: formatMoney(totals.totalAmount),
      },
    },
  };
}
