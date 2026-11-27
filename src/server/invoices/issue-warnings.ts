import { and, eq } from "drizzle-orm";

import { company, customer, invoice, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { getCompanyFiscalContext } from "@/server/company/fiscal-context";
import { issueWarnings, type IssueWarning } from "@/server/invoices/issue-checks";
import { hasUntaxedBase, legalMentionLines } from "@/server/invoices/legal-mentions";
import { isSalesVatTreatment } from "@/server/invoices/lifecycle";
import { loadStoredLines, resolveCustomerBillingDefaults } from "@/server/invoices/service";
import { verifactuTaxCodeFor } from "@/server/verifactu/mapping";

/**
 * Avisos de un borrador antes de emitirlo (ficha de la factura): NIF con el dígito de control mal,
 * NIF-IVA sin comprobar en VIES, plazo de pago de más de 60 días, exportación a un país de la UE y
 * bases sin IVA sin causa de exención. Ninguno bloquea; el de VIES pide confirmación al emitir.
 */
export async function getDraftIssueWarnings(companyId: string, invoiceId: string): Promise<IssueWarning[]> {
  const [row] = await db
    .select({
      invoiceType: invoice.invoiceType,
      customerId: invoice.customerId,
      vatTreatment: invoice.vatTreatment,
      vatExemptionCode: invoice.vatExemptionCode,
      legalMentions: invoice.legalMentions,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      taxId: partner.taxId,
      customerCountry: partner.countryCode,
      viesStatus: customer.viesStatus,
      viesCheckedAt: customer.viesCheckedAt,
      issuerCountry: company.countryCode,
    })
    .from(invoice)
    .innerJoin(customer, eq(customer.id, invoice.customerId))
    .innerJoin(company, eq(company.id, invoice.companyId))
    .leftJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1);
  if (!row) return [];
  const isCreditNote = row.invoiceType === "CREDIT_NOTE";
  const [lines, billing, fiscal] = await Promise.all([
    loadStoredLines(db, invoiceId),
    resolveCustomerBillingDefaults(db, companyId, row.customerId),
    getCompanyFiscalContext(companyId),
  ]);
  const totals = calculateInvoiceTotals(lines, { allowNegative: isCreditNote });
  const vatTreatment = isSalesVatTreatment(row.vatTreatment) ? row.vatTreatment : billing.vatTreatment;
  // El aviso de bases sin IVA es del territorio común (en Canarias el tipo cero existe).
  const commonVatTerritory = fiscal.profile.features.eInvoicing === "verifactu" && verifactuTaxCodeFor(fiscal.homeCountry) === "01";
  return issueWarnings({
    invoiceType: row.invoiceType,
    vatTreatment,
    customerTaxId: row.taxId,
    customerCountry: row.customerCountry ?? "ES",
    // Sin comprobación VIES en el país de la empresa no se pide (el aviso mira si el emisor es de la UE).
    issuerCountry: fiscal.profile.features.vies ? row.issuerCountry : null,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    defaultTermDays: billing.termsDays,
    vies: { status: row.viesStatus, checkedAt: row.viesCheckedAt },
    hasUntaxedDomesticBase: commonVatTerritory && hasUntaxedBase(totals),
    hasExemptionCause: Boolean(row.vatExemptionCode) || legalMentionLines(row.legalMentions).length > 0,
  });
}
