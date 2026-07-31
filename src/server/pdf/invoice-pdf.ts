import { and, eq, inArray } from "drizzle-orm";

import { company, customer, invoice, invoiceLine, invoiceLineTax, partner } from "@/db/schema";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { db } from "@/lib/db";
import { paymentMethodTypeLabels, type PaymentMethodType } from "@/lib/payment-methods";
import type { InvoicePdfInput } from "@/server/pdf/render";

function formatDate(value: Date | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short" }).format(value);
}

function formatMoney(value: number | string, currency: string) {
  const numericValue = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(Number.isFinite(numericValue) ? numericValue : 0);
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
      paymentMethodName: invoice.paymentMethodName,
      paymentMethodType: invoice.paymentMethodType,
      paymentBankAccountNumber: invoice.paymentBankAccountNumber,
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
      companyBaseCurrencyCode: company.baseCurrencyCode,
      customerNumber: partner.number,
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
      id: invoiceLine.id,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitPrice: invoiceLine.unitPrice,
      discountPct: invoiceLine.discountPct,
      taxRate: invoiceLine.taxRate,
      retentionRate: invoiceLine.retentionRate,
      lineTotal: invoiceLine.lineTotal,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId));

  const configuredLineTaxes = lines.length > 0
    ? await db.select({
        invoiceLineId: invoiceLineTax.invoiceLineId,
        taxId: invoiceLineTax.taxId,
        name: invoiceLineTax.name,
        rate: invoiceLineTax.rate,
        kind: invoiceLineTax.kind,
        operation: invoiceLineTax.operation,
      }).from(invoiceLineTax).where(inArray(invoiceLineTax.invoiceLineId, lines.map((line) => line.id)))
    : [];
  const lineTaxes = new Map<string, typeof configuredLineTaxes>();
  for (const configuredTax of configuredLineTaxes) {
    lineTaxes.set(configuredTax.invoiceLineId, [...(lineTaxes.get(configuredTax.invoiceLineId) ?? []), configuredTax]);
  }

  const totals = calculateInvoiceTotals(
    lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountPct: Number(line.discountPct),
      taxRate: Number(line.taxRate),
      retentionRate: Number(line.retentionRate),
      taxes: lineTaxes.get(line.id)?.map((selectedTax) => ({
        id: selectedTax.taxId,
        name: selectedTax.name,
        rate: Number(selectedTax.rate),
        kind: selectedTax.kind,
        operation: selectedTax.operation === "SUBTRACT" ? "SUBTRACT" as const : "ADD" as const,
      })),
    })),
  );
  const breakdownMap = new Map<string, { name: string; rate: number; base: number; amount: number; operation: "ADD" | "SUBTRACT" }>();
  for (const lineTotal of totals.lines) {
    for (const selectedTax of lineTotal.taxes) {
      const name = selectedTax.name ?? (selectedTax.operation === "SUBTRACT" ? "Retención" : "Impuesto");
      const key = `${name}-${selectedTax.rate}-${selectedTax.operation}`;
      const breakdown = breakdownMap.get(key) ?? { name, rate: selectedTax.rate, base: 0, amount: 0, operation: selectedTax.operation };
      breakdown.base = Math.round((breakdown.base + selectedTax.baseAmount + Number.EPSILON) * 100) / 100;
      breakdown.amount = Math.round((breakdown.amount + selectedTax.amount + Number.EPSILON) * 100) / 100;
      breakdownMap.set(key, breakdown);
    }
  }

  return {
    filename: safeInvoiceFilename(row.number),
    input: {
      number: row.number,
      issueDate: formatDate(row.issueDate) ?? "",
      dueDate: formatDate(row.dueDate),
      amount: formatMoney(row.amount, row.companyBaseCurrencyCode),
      payment: row.paymentMethodName ? {
        name: row.paymentMethodName,
        typeLabel: row.paymentMethodType && row.paymentMethodType in paymentMethodTypeLabels
          ? paymentMethodTypeLabels[row.paymentMethodType as PaymentMethodType]
          : null,
        bankAccountNumber: row.paymentBankAccountNumber,
      } : null,
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
        number: row.customerNumber,
        name: row.customerName,
        taxId: row.customerTaxId,
        address: row.customerAddress,
        addressLine2: row.customerAddressLine2,
        postalCode: row.customerPostalCode,
        city: row.customerCity,
        province: row.customerProvince,
        countryCode: row.customerCountryCode,
      },
      lines: lines.map((line, index) => ({
        description: line.description,
        quantity: formatDecimal(line.quantity, 3),
        unitPrice: formatMoney(line.unitPrice, row.companyBaseCurrencyCode),
        taxRate: totals.lines[index]?.taxes.map((selectedTax) => selectedTax.name ?? (selectedTax.operation === "SUBTRACT" ? "Retención" : "Impuesto")).join("\n") || "—",
        lineTotal: formatMoney(line.lineTotal, row.companyBaseCurrencyCode),
      })),
      totals: {
        subtotal: formatMoney(totals.subtotal, row.companyBaseCurrencyCode),
        taxAmount: formatMoney(totals.taxAmount, row.companyBaseCurrencyCode),
        retentionAmount: formatMoney(totals.retentionAmount, row.companyBaseCurrencyCode),
        hasRetention: totals.retentionAmount > 0,
        totalAmount: formatMoney(totals.totalAmount, row.companyBaseCurrencyCode),
        breakdown: [...breakdownMap.values()].map((breakdown) => ({
          name: breakdown.name,
          rate: `${formatDecimal(breakdown.rate, 3)}%`,
          base: formatMoney(breakdown.base, row.companyBaseCurrencyCode),
          amount: formatMoney(breakdown.amount, row.companyBaseCurrencyCode),
          operation: breakdown.operation,
        })),
      },
    },
  };
}
