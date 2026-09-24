import { and, eq } from "drizzle-orm";

import { company, companySettings, customer, invoice, invoicePaymentMethod, partner, type InvoicePartySnapshot } from "@/db/schema";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { db } from "@/lib/db";
import { paymentMethodTypeLabels, type PaymentMethodType } from "@/lib/payment-methods";
import {
  defaultSalesVatTreatment,
  invoiceLifecycle,
  isSalesVatTreatment,
  rectificationReasonLabels,
  rectificationTypeLabels,
  vatTreatmentLegalNotes,
  type RectificationReason,
  type RectificationType,
} from "@/server/invoices/lifecycle";
import { loadStoredLines } from "@/server/invoices/service";
import type { InvoicePdfInput } from "@/server/pdf/render";
import { getInvoiceVerifactuInfo, getInvoiceVerifactuQrPng } from "@/server/verifactu/service";

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

function safeInvoiceFilename(number: string, isCreditNote: boolean) {
  return `${isCreditNote ? "rectificativa" : "invoice"}-${number.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;
}

/**
 * Datos del PDF de una factura. Las facturas emitidas se imprimen desde el snapshot fiscal
 * guardado al emitir (emisor y cliente tal y como eran entonces); los borradores y las facturas
 * antiguas sin snapshot usan los datos actuales de empresa y cliente.
 */
export async function getInvoicePdfData(companyId: string, invoiceId: string): Promise<{ input: InvoicePdfInput; filename: string } | null> {
  const [row] = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      amount: invoice.totalAmount,
      invoiceType: invoice.invoiceType,
      vatTreatment: invoice.vatTreatment,
      rectifiedInvoiceId: invoice.rectifiedInvoiceId,
      rectificationReason: invoice.rectificationReason,
      rectificationType: invoice.rectificationType,
      rectificationDescription: invoice.rectificationDescription,
      issuerSnapshot: invoice.issuerSnapshot,
      customerSnapshot: invoice.customerSnapshot,
      paymentMethodName: invoice.paymentMethodName,
      paymentMethodType: invoice.paymentMethodType,
      paymentBankAccountNumber: invoice.paymentBankAccountNumber,
      pdfShowLogo: companySettings.pdfShowLogo,
      pdfShowEmail: companySettings.pdfShowEmail,
      pdfShowPhone: companySettings.pdfShowPhone,
      pdfShowWebsite: companySettings.pdfShowWebsite,
      pdfShowCustomerNumber: companySettings.pdfShowCustomerNumber,
      pdfShowPaymentMethod: companySettings.pdfShowPaymentMethod,
      pdfShowTaxBreakdown: companySettings.pdfShowTaxBreakdown,
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
    .leftJoin(companySettings, eq(companySettings.companyId, company.id))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);

  if (!row) return null;

  const isCreditNote = row.invoiceType === "CREDIT_NOTE";
  const lifecycle = invoiceLifecycle(row);
  const currency = row.companyBaseCurrencyCode;

  const [lines, selectedPaymentMethods, [original]] = await Promise.all([
    loadStoredLines(db, invoiceId),
    db.select({
      name: invoicePaymentMethod.name,
      type: invoicePaymentMethod.type,
      bankAccountNumber: invoicePaymentMethod.bankAccountNumber,
      position: invoicePaymentMethod.position,
    }).from(invoicePaymentMethod)
      .where(eq(invoicePaymentMethod.invoiceId, invoiceId))
      .orderBy(invoicePaymentMethod.position),
    row.rectifiedInvoiceId
      ? db.select({ number: invoice.number, issueDate: invoice.issueDate })
          .from(invoice)
          .where(and(eq(invoice.id, row.rectifiedInvoiceId), eq(invoice.companyId, companyId)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const totals = calculateInvoiceTotals(lines, { allowNegative: isCreditNote });
  const verifactuInfo = lifecycle === "ISSUED" ? await getInvoiceVerifactuInfo(companyId, invoiceId) : null;
  const verifactu = verifactuInfo
    ? { qrDataUrl: await getInvoiceVerifactuQrPng(verifactuInfo), legends: verifactuInfo.legends, url: verifactuInfo.url }
    : null;

  const issuer: InvoicePartySnapshot = row.issuerSnapshot ?? {
    name: row.companyName,
    legalName: row.companyLegalName,
    taxId: row.companyVatNumber,
    address: row.companyFiscalAddress,
    addressLine2: row.companyFiscalAddressLine2,
    postalCode: row.companyPostalCode,
    city: row.companyCity,
    province: row.companyProvince,
    countryCode: row.companyCountryCode,
    email: row.companyEmail,
    phone: row.companyPhone,
    website: row.companyWebsite,
  };
  const customerParty: InvoicePartySnapshot = row.customerSnapshot ?? {
    name: row.customerName,
    taxId: row.customerTaxId,
    address: row.customerAddress,
    addressLine2: row.customerAddressLine2,
    postalCode: row.customerPostalCode,
    city: row.customerCity,
    province: row.customerProvince,
    countryCode: row.customerCountryCode,
    number: row.customerNumber,
  };

  const vatTreatment = isSalesVatTreatment(row.vatTreatment) ? row.vatTreatment : defaultSalesVatTreatment(customerParty.countryCode);
  const legalNotes = [vatTreatmentLegalNotes[vatTreatment]].filter((note): note is string => Boolean(note));

  const reasonLabel = row.rectificationReason && row.rectificationReason in rectificationReasonLabels
    ? rectificationReasonLabels[row.rectificationReason as RectificationReason]
    : null;
  const typeLabel = row.rectificationType && row.rectificationType in rectificationTypeLabels
    ? rectificationTypeLabels[row.rectificationType as RectificationType]
    : null;

  return {
    filename: safeInvoiceFilename(row.number, isCreditNote),
    input: {
      documentTitle: lifecycle === "DRAFT" ? (isCreditNote ? "Borrador de rectificativa" : "Borrador") : isCreditNote ? "Factura rectificativa" : "Factura",
      documentEyebrow: lifecycle === "DRAFT" ? "Documento sin validez fiscal" : lifecycle === "VOID" ? "Documento anulado" : "Documento comercial",
      number: row.number,
      issueDate: formatDate(row.issueDate) ?? "",
      dueDate: formatDate(row.dueDate),
      amount: formatMoney(row.amount, currency),
      draft: lifecycle === "DRAFT",
      verifactu,
      legalNotes,
      rectification: isCreditNote
        ? {
            originalNumber: original?.number ?? "—",
            originalIssueDate: formatDate(original?.issueDate ?? null) ?? "—",
            reason: reasonLabel ?? "—",
            type: typeLabel ?? "—",
            description: row.rectificationDescription ?? null,
          }
        : null,
      display: {
        showLogo: row.pdfShowLogo ?? true,
        showEmail: row.pdfShowEmail ?? true,
        showPhone: row.pdfShowPhone ?? true,
        showWebsite: row.pdfShowWebsite ?? true,
        showCustomerNumber: row.pdfShowCustomerNumber ?? true,
        showPaymentMethod: (row.pdfShowPaymentMethod ?? true) && !isCreditNote,
        showTaxBreakdown: row.pdfShowTaxBreakdown ?? true,
      },
      payments: (selectedPaymentMethods.length > 0
        ? selectedPaymentMethods
        : row.paymentMethodName
          ? [{ name: row.paymentMethodName, type: row.paymentMethodType, bankAccountNumber: row.paymentBankAccountNumber, position: 0 }]
          : []).map((method) => ({
            name: method.name,
            typeLabel: method.type && method.type in paymentMethodTypeLabels
              ? paymentMethodTypeLabels[method.type as PaymentMethodType]
              : null,
            bankAccountNumber: method.bankAccountNumber,
          })),
      company: {
        name: issuer.name,
        legalName: issuer.legalName ?? null,
        vatNumber: issuer.taxId,
        fiscalAddress: issuer.address,
        fiscalAddressLine2: issuer.addressLine2,
        postalCode: issuer.postalCode,
        city: issuer.city,
        province: issuer.province,
        countryCode: issuer.countryCode,
        email: issuer.email ?? null,
        phone: issuer.phone ?? null,
        website: issuer.website ?? null,
        // Logo y pie son presentación, no datos fiscales: siempre los actuales.
        logoDataUrl: row.companyLogoDataUrl,
        invoiceFooter: row.companyInvoiceFooter,
      },
      customer: {
        number: customerParty.number ?? null,
        name: customerParty.name,
        taxId: customerParty.taxId,
        address: customerParty.address,
        addressLine2: customerParty.addressLine2,
        postalCode: customerParty.postalCode,
        city: customerParty.city,
        province: customerParty.province,
        countryCode: customerParty.countryCode,
      },
      lines: lines.map((line, index) => ({
        description: line.description,
        quantity: formatDecimal(line.quantity, 3),
        unitPrice: formatMoney(line.unitPrice, currency),
        taxRate: totals.lines[index]?.taxes.map((selectedTax) => selectedTax.name ?? (selectedTax.operation === "SUBTRACT" ? "Retención" : "Impuesto")).join("\n") || "—",
        lineTotal: formatMoney(totals.lines[index]?.lineTotal ?? 0, currency),
      })),
      totals: {
        subtotal: formatMoney(totals.subtotal, currency),
        taxAmount: formatMoney(totals.taxAmount, currency),
        retentionAmount: formatMoney(totals.retentionAmount, currency),
        hasRetention: totals.retentionAmount !== 0,
        totalAmount: formatMoney(totals.totalAmount, currency),
        // Desglose por tipo impositivo (base y cuota por tipo, art. 6.1.f/g RD 1619/2012).
        breakdown: totals.taxBuckets.map((bucket) => ({
          name: bucket.name ?? (bucket.operation === "SUBTRACT" ? "Retención" : "Impuesto"),
          rate: `${formatDecimal(bucket.rate, 3)}%`,
          base: formatMoney(bucket.baseAmount, currency),
          amount: formatMoney(bucket.amount, currency),
          operation: bucket.operation,
        })),
      },
    },
  };
}
