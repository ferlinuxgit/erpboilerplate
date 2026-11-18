import { and, asc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { company, customer, fiscalYear, invoice, partner, tenant } from "@/db/schema";
import { stripeInvoiceToDraft } from "@/lib/billing/platform-invoice-draft";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Facturas legales del propio SaaS. Las facturas de Stripe no cumplen la normativa española
 * (VERI*FACTU), así que cada cobro pagado (`invoice.paid`) se factura también desde la empresa de la
 * plataforma dentro de este mismo ERP (PLATFORM_INVOICE_COMPANY_ID): registro VERI*FACTU, numeración
 * y libros de IVA. La de Stripe queda como recibo de pago.
 *
 * IVA: Stripe Tax ya calculó el impuesto según el cliente; aquí se traduce al tratamiento español.
 * - 21 % → nacional.
 * - 0 % a una empresa de la UE con NIF-IVA → servicio intracomunitario (inversión del sujeto pasivo).
 * - 0 % fuera de la UE o en Canarias / Ceuta / Melilla → no sujeto.
 * Lo que no encaja (sin NIF, IVA de otro país por ventanilla única…) no se emite solo: queda en el
 * log para emitirlo a mano.
 */

/** Emite la factura legal de un cobro de Stripe en la empresa de la plataforma (una sola vez). */
export async function issuePlatformInvoice(stripeInvoice: Stripe.Invoice) {
  const companyId = process.env.PLATFORM_INVOICE_COMPANY_ID?.trim();
  if (!companyId || !stripeInvoice.id || stripeInvoice.amount_paid <= 0) return "skipped" as const;
  const [already] = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.companyId, companyId), ilike(invoice.notes, `%(${stripeInvoice.id})%`))).limit(1);
  if (already) return "duplicate" as const;
  const draft = stripeInvoiceToDraft(stripeInvoice);
  if ("problem" in draft) {
    logger.warn({ stripeInvoiceId: stripeInvoice.id, problem: draft.problem }, "platform_invoice.manual_required");
    return "manual" as const;
  }
  const [operator] = await db
    .select({ tenantId: company.tenantId, countryCode: company.countryCode, ownerId: tenant.ownerId })
    .from(company)
    .innerJoin(tenant, eq(tenant.id, company.tenantId))
    .where(eq(company.id, companyId))
    .limit(1);
  if (!operator) throw new Error("PLATFORM_INVOICE_COMPANY_ID no corresponde a ninguna empresa.");
  const issueDate = new Date(`${draft.issueDate}T12:00:00Z`);
  const [year] = await db
    .select({ id: fiscalYear.id })
    .from(fiscalYear)
    .where(and(eq(fiscalYear.companyId, companyId), lte(fiscalYear.startsAt, issueDate), gte(fiscalYear.endsAt, issueDate)))
    .orderBy(asc(fiscalYear.startsAt))
    .limit(1);
  if (!year) throw new Error(`La empresa de la plataforma no tiene ejercicio abierto para ${draft.issueDate}.`);
  // Cliente ya facturado otros meses: se reutiliza (mismo NIF), no se crea uno cada vez.
  const normalizedTaxId = draft.customer.taxId.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const [known] = await db
    .select({ id: customer.id })
    .from(customer)
    .innerJoin(partner, eq(partner.id, customer.partnerId))
    .where(and(eq(customer.companyId, companyId), sql`upper(regexp_replace(${partner.taxId}, '[^A-Za-z0-9]', '', 'g')) = ${normalizedTaxId}`))
    .orderBy(asc(customer.createdAt))
    .limit(1);
  const { createInvoice } = await import("@/server/invoices/service");
  const created = await createInvoice(
    { tenantId: operator.tenantId, companyId, actorUserId: operator.ownerId, countryCode: operator.countryCode, activeFiscalYearId: year.id, canCreateCustomer: true },
    {
      ...(known ? { customerId: known.id } : { newCustomer: draft.customer }),
      issueDate: draft.issueDate,
      vatTreatment: draft.vatTreatment,
      notes: draft.notes,
      mode: "issue",
      lines: draft.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate, retentionRate: 0 })),
    },
  );
  logger.info({ stripeInvoiceId: stripeInvoice.id, invoiceId: created.id }, "platform_invoice.issued");
  return "issued" as const;
}
