import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { customer, deliveryNote, invoice, partner, salesOrder, salesQuote } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { normalizeTaxIdentity } from "@/lib/expense-dedup";
import { HttpError } from "@/lib/http";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { CUSTOMER_HAS_DOCUMENTS_MESSAGE, normalizeIban, type customerBillingSchema } from "@/server/customers/schemas";
import { isSalesVatTreatment } from "@/server/invoices/lifecycle";
import { creditedByInvoiceSubquery, invoiceIsDraftSql, invoiceIsIssuedSql, netOutstandingSql, paidByInvoiceSubquery } from "@/server/invoices/sql";
import { reservePartnerNumber } from "@/server/partners/numbers";
import { createCustomerSchema, updateCustomerSchema } from "@/server/schemas/forms";

type BillingInput = Partial<z.infer<typeof customerBillingSchema>>;
type CreateCustomerInput = z.infer<typeof createCustomerSchema> & BillingInput;
type UpdateCustomerInput = z.infer<typeof updateCustomerSchema> & BillingInput;

/** Condiciones de facturación de la ficha (solo los campos presentes en la petición). */
export function billingValues(input: BillingInput) {
  return {
    ...(input.defaultRetentionRate !== undefined
      ? { defaultRetentionRate: input.defaultRetentionRate === null || input.defaultRetentionRate === 0 ? null : input.defaultRetentionRate.toFixed(3) }
      : {}),
    ...(input.defaultVatTreatment !== undefined
      ? { defaultVatTreatment: isSalesVatTreatment(input.defaultVatTreatment) ? input.defaultVatTreatment : null }
      : {}),
    ...(input.invoiceEmail !== undefined ? { invoiceEmail: input.invoiceEmail?.trim() || null } : {}),
    ...(input.iban !== undefined ? { iban: normalizeIban(input.iban) || null } : {}),
    ...(input.equivalenceSurcharge !== undefined ? { equivalenceSurcharge: input.equivalenceSurcharge } : {}),
  };
}

function partnerTermsValues(input: BillingInput) {
  return input.paymentTermsDays !== undefined ? { paymentTermsDays: input.paymentTermsDays ?? null } : {};
}

function cleanOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeCountryCode(value: string | null | undefined) {
  return (value?.trim() || "ES").toUpperCase();
}

function fiscalValues(input: CreateCustomerInput | UpdateCustomerInput) {
  return {
    name: input.name.trim(),
    email: cleanOptional(input.email),
    phone: cleanOptional(input.phone),
    taxId: normalizeSpanishTaxId(input.taxId),
    taxIdNormalized: normalizeTaxIdentity(input.taxId, input.countryCode),
    address: input.address.trim(),
    addressLine2: cleanOptional(input.addressLine2),
    city: input.city.trim(),
    province: input.province.trim(),
    postalCode: input.postalCode.trim(),
    countryCode: normalizeCountryCode(input.countryCode),
  };
}

function partnerTypeForCustomer(currentType: "CUSTOMER" | "SUPPLIER" | "BOTH") {
  return currentType === "SUPPLIER" ? "BOTH" : currentType;
}

export async function createCustomerWithPartner(dbClient: DbClient, companyId: string, input: CreateCustomerInput) {
  const values = fiscalValues(input);
  const existingPartners = await dbClient
    .select({ id: partner.id, number: partner.number, type: partner.type })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.countryCode, values.countryCode), eq(partner.taxIdNormalized, values.taxIdNormalized)))
    .limit(1);

  const partnerRecord = existingPartners[0] ?? (
    await dbClient
      .insert(partner)
      .values({
        companyId,
        number: await reservePartnerNumber(dbClient, companyId, "CUSTOMER"),
        type: "CUSTOMER",
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
        taxIdNormalized: values.taxIdNormalized,
        address: values.address,
        addressLine2: values.addressLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
        ...partnerTermsValues(input),
      })
      .returning({ id: partner.id, number: partner.number, type: partner.type })
  )[0];
  const partnerId = partnerRecord.id;

  if (existingPartners[0]) {
    await dbClient
      .update(partner)
      .set({
        type: partnerTypeForCustomer(existingPartners[0].type),
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
        taxIdNormalized: values.taxIdNormalized,
        address: values.address,
        addressLine2: values.addressLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
        ...partnerTermsValues(input),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(and(eq(partner.id, partnerId), eq(partner.companyId, companyId)));
  }

  const [createdCustomer] = await dbClient
    .insert(customer)
    .values({
      name: values.name,
      email: values.email,
      phone: values.phone,
      companyId,
      partnerId,
      ...billingValues(input),
    })
    .returning({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      partnerId: customer.partnerId,
    });

  return { ...createdCustomer, number: partnerRecord.number };
}

export async function updateCustomerWithPartner(
  dbClient: DbClient,
  companyId: string,
  customerId: string,
  currentPartnerId: string | null,
  input: UpdateCustomerInput,
) {
  const values = fiscalValues(input);
  let partnerId = currentPartnerId;
  let fiscalIdentityChanged = !partnerId;

  if (partnerId) {
    const existingPartners = await dbClient
      .select({ type: partner.type, taxIdNormalized: partner.taxIdNormalized, countryCode: partner.countryCode })
      .from(partner)
      .where(and(eq(partner.id, partnerId), eq(partner.companyId, companyId)))
      .limit(1);
    fiscalIdentityChanged = !existingPartners[0]
      || existingPartners[0].taxIdNormalized !== values.taxIdNormalized
      || existingPartners[0].countryCode !== values.countryCode;

    await dbClient
      .update(partner)
      .set({
        type: existingPartners[0] ? partnerTypeForCustomer(existingPartners[0].type) : "CUSTOMER",
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
        taxIdNormalized: values.taxIdNormalized,
        address: values.address,
        addressLine2: values.addressLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
        ...partnerTermsValues(input),
        isActive: input.status !== "INACTIVE",
        updatedAt: new Date(),
      })
      .where(and(eq(partner.id, partnerId), eq(partner.companyId, companyId)));
  } else {
    partnerId = (
      await dbClient
        .insert(partner)
        .values({
          companyId,
          number: await reservePartnerNumber(dbClient, companyId, "CUSTOMER"),
          type: "CUSTOMER",
          name: values.name,
          email: values.email,
          phone: values.phone,
          taxId: values.taxId,
          taxIdNormalized: values.taxIdNormalized,
          address: values.address,
          addressLine2: values.addressLine2,
          city: values.city,
          province: values.province,
          postalCode: values.postalCode,
          countryCode: values.countryCode,
          ...partnerTermsValues(input),
          isActive: input.status !== "INACTIVE",
        })
        .returning({ id: partner.id })
    )[0].id;
  }

  const [updatedCustomer] = await dbClient
    .update(customer)
    .set({
      name: values.name,
      email: values.email,
      phone: values.phone,
      status: input.status ?? "ACTIVE",
      partnerId,
      ...billingValues(input),
      // La comprobación VIES deja de valer si cambia el NIF-IVA o el país.
      ...(fiscalIdentityChanged ? { viesStatus: null, viesName: null, viesCheckedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId)))
    .returning();

  return updatedCustomer;
}

export { CUSTOMER_HAS_DOCUMENTS_MESSAGE };

export async function countCustomerDocuments(client: DbClient, companyId: string, customerId: string) {
  const [[invoices], [quotes], [orders], [deliveries]] = await Promise.all([
    client.select({ value: count() }).from(invoice).where(and(eq(invoice.companyId, companyId), eq(invoice.customerId, customerId))),
    client.select({ value: count() }).from(salesQuote).where(and(eq(salesQuote.companyId, companyId), eq(salesQuote.customerId, customerId))),
    client.select({ value: count() }).from(salesOrder).where(and(eq(salesOrder.companyId, companyId), eq(salesOrder.customerId, customerId))),
    client.select({ value: count() }).from(deliveryNote).where(and(eq(deliveryNote.companyId, companyId), eq(deliveryNote.customerId, customerId))),
  ]);
  return Number(invoices?.value ?? 0) + Number(quotes?.value ?? 0) + Number(orders?.value ?? 0) + Number(deliveries?.value ?? 0);
}

/** Lanza 409 (con la acción sugerida) si el cliente tiene facturas o documentos comerciales. */
export async function assertCustomerDeletable(client: DbClient, companyId: string, customerId: string) {
  const documents = await countCustomerDocuments(client, companyId, customerId);
  if (documents > 0) throw new HttpError(409, CUSTOMER_HAS_DOCUMENTS_MESSAGE);
}

/**
 * Saldo real del cliente con las mismas reglas que la lista de facturas:
 * - Facturado: facturas emitidas y no anuladas (sin borradores), rectificativas restando.
 * - Pendiente: total + rectificativas − cobros de cada factura, nunca negativo.
 */
export function customerBalanceQuery(companyId: string, customerId: string) {
  const paid = paidByInvoiceSubquery(companyId, "customer_paid");
  const credited = creditedByInvoiceSubquery(companyId, "customer_credited");
  return db
    .select({
      invoiced: sql<string>`coalesce(sum(case when ${invoiceIsIssuedSql} then ${invoice.totalAmount} else 0 end), 0)`.mapWith(Number),
      outstanding: sql<string>`coalesce(sum(${netOutstandingSql(paid, credited)}), 0)`.mapWith(Number),
      issuedCount: sql<number>`count(*) filter (where ${invoiceIsIssuedSql} and ${invoice.invoiceType} = 'INVOICE')`.mapWith(Number),
      draftCount: sql<number>`count(*) filter (where ${invoiceIsDraftSql} and ${invoice.status} <> 'VOID')`.mapWith(Number),
    })
    .from(invoice)
    .leftJoin(paid, eq(paid.invoiceId, invoice.id))
    .leftJoin(credited, eq(credited.invoiceId, invoice.id))
    .where(and(eq(invoice.companyId, companyId), eq(invoice.customerId, customerId)));
}

export async function getCustomerBalance(companyId: string, customerId: string) {
  const [row] = await customerBalanceQuery(companyId, customerId);
  return {
    invoiced: Math.round((row?.invoiced ?? 0) * 100) / 100,
    outstanding: Math.round((row?.outstanding ?? 0) * 100) / 100,
    issuedCount: row?.issuedCount ?? 0,
    draftCount: row?.draftCount ?? 0,
  };
}
