import { and, asc, eq, inArray } from "drizzle-orm";

import { taxTerritoryOf } from "@/lib/country-packs/territory";
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
  vatTreatmentLegalNote,
  type RectificationReason,
  type RectificationType,
} from "@/server/invoices/lifecycle";
import { documentClassTitle, effectiveDocumentClass } from "@/server/invoices/document-class";
import { civilDateKey } from "@/server/invoices/issue-checks";
import { legalMentionLines, untaxedBaseLegalNote } from "@/server/invoices/legal-mentions";
import { verifactuTaxCodeFor } from "@/server/verifactu/mapping";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { loadStoredLines } from "@/server/invoices/service";
import type { InvoicePdfInput } from "@/server/pdf/render";
import { getInvoiceVerifactuInfo, getInvoiceVerifactuQrPng } from "@/server/verifactu/service";
import { formatRate, lineTaxColumns, taxTotalRows } from "@/server/pdf/invoice-tax-labels";

/**
 * Fecha impresa: el mismo día civil que consta en el registro VERI*FACTU. Una fecha de formulario
 * (00:00 UTC) es ya su día; un instante (ticket del TPV…) se lee en hora peninsular, no en la zona
 * del servidor.
 */
function formatDate(value: Date | null) {
  if (!value) return null;
  const [year, month, day] = civilDateKey(value).split("-");
  return `${Number(day)}/${Number(month)}/${year.slice(2)}`;
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
      operationDate: invoice.operationDate,
      vatExemptionCode: invoice.vatExemptionCode,
      documentClass: invoice.documentClass,
      legalMentions: invoice.legalMentions,
      isSubstitutive: invoice.isSubstitutive,
      substitutesInvoiceIds: invoice.substitutesInvoiceIds,
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
      fiscalRegime: companySettings.fiscalRegime,
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

  const [lines, selectedPaymentMethods, [original], substituted] = await Promise.all([
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
    row.isSubstitutive && (row.substitutesInvoiceIds ?? []).length > 0
      ? db.select({ number: invoice.number, issueDate: invoice.issueDate })
          .from(invoice)
          .where(and(eq(invoice.companyId, companyId), inArray(invoice.id, row.substitutesInvoiceIds ?? [])))
          .orderBy(asc(invoice.issueDate))
      : Promise.resolve([]),
  ]);

  const totals = calculateInvoiceTotals(lines, { allowNegative: isCreditNote });
  const verifactuInfo = lifecycle === "ISSUED" ? await getInvoiceVerifactuInfo(companyId, invoiceId) : null;
  const verifactu = verifactuInfo
    ? { qrDataUrl: await getInvoiceVerifactuQrPng(verifactuInfo), caption: verifactuInfo.caption, legends: verifactuInfo.legends, url: verifactuInfo.url }
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

  const vatTreatment = isSalesVatTreatment(row.vatTreatment) ? row.vatTreatment : defaultSalesVatTreatment(customerParty.countryCode, issuer.countryCode);
  // Fecha de la operación, cuando no coincide con la de expedición (art. 6.1.i RD 1619/2012).
  const operationDate = row.operationDate && formatDate(row.operationDate) !== formatDate(row.issueDate) ? formatDate(row.operationDate) : null;
  // Clase de documento: la congelada al emitir; antes de emitir, la elegida o la que resulta del NIF.
  const documentClass = effectiveDocumentClass({ documentClass: row.documentClass, customerTaxId: customerParty.taxId });
  const territory = taxTerritoryOf(issuer);
  const legalNotes = [
    // Canje (art. 7.2 del Reglamento de facturación): referencia a las simplificadas sustituidas.
    substituted.length > 0
      ? `Factura expedida en sustitución de ${substituted.length === 1 ? "la factura simplificada" : "las facturas simplificadas"} ${substituted.map((entry) => `${entry.number} (${formatDate(entry.issueDate)})`).join(", ")}.`
      : null,
    operationDate ? `Fecha de la operación: ${operationDate}.` : null,
    vatTreatmentLegalNote(vatTreatment, territory, row.fiscalRegime),
    // Art. 6.1.j: causa de exención de las bases sin IVA de una factura nacional.
    untaxedBaseLegalNote({
      vatTreatment,
      commonVatTerritory: getCountryFiscalProfile(issuer.countryCode).features.eInvoicing === "verifactu" && verifactuTaxCodeFor(territory) === "01",
      exemptionCode: row.vatExemptionCode,
      legalMentions: row.legalMentions,
      totals,
    }),
    // Menciones propias de la factura (regímenes especiales, artículo de la exención…).
    ...legalMentionLines(row.legalMentions),
    // Art. 6.1.p del Reglamento de facturación (también en el IGIC, art. 163 decies LIVA y Ley 20/1991).
    row.fiscalRegime === "cash_accounting" ? "Régimen especial del criterio de caja." : null,
  ].filter((note): note is string => Boolean(note));

  const reasonLabel = row.rectificationReason && row.rectificationReason in rectificationReasonLabels
    ? rectificationReasonLabels[row.rectificationReason as RectificationReason]
    : null;
  // La factura debe decir lo mismo que su registro VERI*FACTU (TipoRectificativa = "I"). Nuestras
  // rectificativas expresan siempre los importes por diferencias: también las que el formulario
  // llama «por sustitución», que llevan las líneas originales en negativo y las correctas en positivo.
  const typeLabel = row.rectificationType === "SUBSTITUTION"
    ? `${rectificationTypeLabels.DIFFERENCES} (anula las líneas de la factura original e incluye las correctas)`
    : row.rectificationType && row.rectificationType in rectificationTypeLabels
      ? rectificationTypeLabels[row.rectificationType as RectificationType]
      : null;

  return {
    filename: safeInvoiceFilename(row.number, isCreditNote),
    input: {
      documentTitle: lifecycle === "DRAFT" ? (isCreditNote ? "Borrador de rectificativa" : "Borrador") : isCreditNote ? "Factura rectificativa" : documentClassTitle(documentClass),
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
      // Cada línea muestra su base y los tipos de IVA/IRPF; las cuotas van en los totales.
      lines: lines.map((line, index) => {
        const lineTotals = totals.lines[index];
        const columns = lineTaxColumns(lineTotals?.taxes ?? []);
        return {
          description: line.description,
          quantity: formatDecimal(line.quantity, 3),
          unitPrice: formatMoney(line.unitPrice, currency),
          discount: Number(line.discountPct ?? 0) ? formatRate(Number(line.discountPct)) : null,
          taxRate: columns.vat,
          vat: columns.vat,
          withholding: columns.withholding,
          lineTotal: formatMoney(lineTotals?.subtotal ?? 0, currency),
        };
      }),
      totals: {
        subtotal: formatMoney(totals.subtotal, currency),
        taxAmount: formatMoney(totals.taxAmount, currency),
        retentionAmount: formatMoney(totals.retentionAmount, currency),
        hasRetention: totals.retentionAmount !== 0,
        totalAmount: formatMoney(totals.totalAmount, currency),
        // Una fila por impuesto y tipo con su base (art. 6.1.f/g RD 1619/2012).
        taxRows: taxTotalRows(totals.taxBuckets, (value) => formatMoney(value, currency)),
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
