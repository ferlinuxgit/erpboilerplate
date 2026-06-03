import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { purchaseOrder, supplierInvoice, supplierInvoicePayment, supplierPayment, partner } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { createSupplierSchema, updateSupplierSchema } from "@/server/schemas/forms";

type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

function cleanOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeCountryCode(value: string | null | undefined) {
  return (value?.trim() || "ES").toUpperCase();
}

function supplierValues(input: CreateSupplierInput | UpdateSupplierInput) {
  return {
    name: input.name.trim(),
    email: cleanOptional(input.email),
    phone: cleanOptional(input.phone),
    taxId: normalizeSpanishTaxId(input.taxId),
    address: input.address.trim(),
    addressLine2: cleanOptional(input.addressLine2),
    city: input.city.trim(),
    province: input.province.trim(),
    postalCode: input.postalCode.trim(),
    countryCode: normalizeCountryCode(input.countryCode),
    isActive: "status" in input && input.status ? input.status === "ACTIVE" : true,
    paymentTermsDays: "paymentTermsDays" in input ? input.paymentTermsDays : 30,
    paymentMethodId: cleanOptional("paymentMethodId" in input ? input.paymentMethodId : undefined),
    defaultAccountId: cleanOptional("defaultAccountId" in input ? input.defaultAccountId : undefined),
    currencyCode: ("currencyCode" in input ? input.currencyCode : "EUR").trim().toUpperCase(),
  };
}

function partnerTypeForSupplier(currentType: "CUSTOMER" | "SUPPLIER" | "BOTH") {
  return currentType === "CUSTOMER" ? "BOTH" : currentType;
}

export async function listSuppliers(dbClient: DbClient, companyId: string) {
  return dbClient
    .select({
      id: partner.id,
      name: partner.name,
      email: partner.email,
      phone: partner.phone,
      taxId: partner.taxId,
      address: partner.address,
      addressLine2: partner.addressLine2,
      postalCode: partner.postalCode,
      city: partner.city,
      province: partner.province,
      countryCode: partner.countryCode,
      type: partner.type,
      isActive: partner.isActive,
      paymentTermsDays: partner.paymentTermsDays,
      paymentMethodId: partner.paymentMethodId,
      defaultAccountId: partner.defaultAccountId,
      currencyCode: partner.currencyCode,
      createdAt: partner.createdAt,
      updatedAt: partner.updatedAt,
    })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])))
    .orderBy(desc(partner.createdAt));
}

export async function getSupplier(dbClient: DbClient, companyId: string, id: string) {
  const [row] = await dbClient
    .select({
      id: partner.id,
      name: partner.name,
      email: partner.email,
      phone: partner.phone,
      taxId: partner.taxId,
      address: partner.address,
      addressLine2: partner.addressLine2,
      postalCode: partner.postalCode,
      city: partner.city,
      province: partner.province,
      countryCode: partner.countryCode,
      type: partner.type,
      isActive: partner.isActive,
      paymentTermsDays: partner.paymentTermsDays,
      paymentMethodId: partner.paymentMethodId,
      defaultAccountId: partner.defaultAccountId,
      currencyCode: partner.currencyCode,
      createdAt: partner.createdAt,
      updatedAt: partner.updatedAt,
    })
    .from(partner)
    .where(and(eq(partner.id, id), eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])))
    .limit(1);
  return row;
}

export async function createSupplierWithPartner(dbClient: DbClient, companyId: string, input: CreateSupplierInput) {
  const values = supplierValues(input);
  const [existing] = await dbClient
    .select({ id: partner.id, type: partner.type })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.taxId, values.taxId)))
    .limit(1);

  if (existing) {
    const [updated] = await dbClient
      .update(partner)
      .set({
        type: partnerTypeForSupplier(existing.type),
        name: values.name,
        email: values.email,
        phone: values.phone,
        taxId: values.taxId,
        address: values.address,
        addressLine2: values.addressLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
        paymentTermsDays: values.paymentTermsDays,
        paymentMethodId: values.paymentMethodId,
        defaultAccountId: values.defaultAccountId,
        currencyCode: values.currencyCode,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(and(eq(partner.id, existing.id), eq(partner.companyId, companyId)))
      .returning({ id: partner.id, name: partner.name, email: partner.email, phone: partner.phone, taxId: partner.taxId, city: partner.city, province: partner.province, countryCode: partner.countryCode, isActive: partner.isActive });
    return updated;
  }

  const [created] = await dbClient
    .insert(partner)
    .values({
      companyId,
      type: "SUPPLIER",
      name: values.name,
      email: values.email,
      phone: values.phone,
      taxId: values.taxId,
      address: values.address,
      addressLine2: values.addressLine2,
      city: values.city,
      province: values.province,
      postalCode: values.postalCode,
      countryCode: values.countryCode,
      paymentTermsDays: values.paymentTermsDays,
      paymentMethodId: values.paymentMethodId,
      defaultAccountId: values.defaultAccountId,
      currencyCode: values.currencyCode,
      isActive: true,
    })
    .returning({ id: partner.id, name: partner.name, email: partner.email, phone: partner.phone, taxId: partner.taxId, city: partner.city, province: partner.province, countryCode: partner.countryCode, isActive: partner.isActive });
  return created;
}

export async function updateSupplierWithPartner(dbClient: DbClient, companyId: string, id: string, input: UpdateSupplierInput) {
  const values = supplierValues(input);
  const [duplicate] = await dbClient
    .select({ id: partner.id })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.taxId, values.taxId), ne(partner.id, id)))
    .limit(1);
  if (duplicate) throw new Error("Ya existe otro tercero con ese CIF/NIF.");

  const [updated] = await dbClient
    .update(partner)
    .set({
      name: values.name,
      email: values.email,
      phone: values.phone,
      taxId: values.taxId,
      address: values.address,
      addressLine2: values.addressLine2,
      city: values.city,
      province: values.province,
      postalCode: values.postalCode,
      countryCode: values.countryCode,
      paymentTermsDays: values.paymentTermsDays,
      paymentMethodId: values.paymentMethodId,
      defaultAccountId: values.defaultAccountId,
      currencyCode: values.currencyCode,
      isActive: values.isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(partner.id, id), eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])))
    .returning({ id: partner.id, name: partner.name, email: partner.email, phone: partner.phone, taxId: partner.taxId, city: partner.city, province: partner.province, countryCode: partner.countryCode, isActive: partner.isActive });
  return updated;
}

export async function getSupplierActivity(dbClient: DbClient, companyId: string, supplierId: string) {
  const [invoices, payments, purchaseOrders] = await Promise.all([
    dbClient
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        origin: supplierInvoice.origin,
        issueDate: supplierInvoice.issueDate,
        dueDate: supplierInvoice.dueDate,
        paymentStatus: supplierInvoice.paymentStatus,
        totalAmount: supplierInvoice.totalAmount,
      })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.supplierPartnerId, supplierId)))
      .orderBy(desc(supplierInvoice.issueDate)),
    dbClient
      .select({
        supplierInvoiceId: supplierInvoicePayment.supplierInvoiceId,
        amountApplied: supplierInvoicePayment.amountApplied,
      })
      .from(supplierInvoicePayment)
      .where(eq(supplierInvoicePayment.companyId, companyId)),
    dbClient
      .select({
        id: purchaseOrder.id,
        number: purchaseOrder.number,
        status: purchaseOrder.status,
        createdAt: purchaseOrder.createdAt,
      })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.companyId, companyId), eq(purchaseOrder.supplierPartnerId, supplierId)))
      .orderBy(desc(purchaseOrder.createdAt)),
  ]);

  const paidByInvoice = new Map<string, number>();
  for (const payment of payments) {
    paidByInvoice.set(payment.supplierInvoiceId, (paidByInvoice.get(payment.supplierInvoiceId) ?? 0) + Number(payment.amountApplied));
  }

  const invoiceRows = invoices.map((invoice) => {
    const totalAmount = Number(invoice.totalAmount);
    const paidAmount = paidByInvoice.get(invoice.id) ?? 0;
    const outstandingAmount = Math.max(totalAmount - paidAmount, 0);
    return { ...invoice, totalAmount, paidAmount, outstandingAmount };
  });

  const totalInvoiced = invoiceRows.reduce((total, invoice) => total + invoice.totalAmount, 0);
  const outstandingAmount = invoiceRows.reduce((total, invoice) => total + invoice.outstandingAmount, 0);
  const overdueAmount = invoiceRows
    .filter((invoice) => invoice.dueDate && invoice.dueDate.getTime() < Date.now() && invoice.outstandingAmount > 0)
    .reduce((total, invoice) => total + invoice.outstandingAmount, 0);

  const recentPayments = await dbClient
    .select({
      id: supplierPayment.id,
      supplierInvoiceId: supplierPayment.supplierInvoiceId,
      amount: supplierPayment.amount,
      postedAt: supplierPayment.postedAt,
    })
    .from(supplierPayment)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierPayment.supplierInvoiceId))
    .where(and(eq(supplierPayment.companyId, companyId), eq(supplierInvoice.supplierPartnerId, supplierId)))
    .orderBy(desc(supplierPayment.postedAt));

  return {
    metrics: {
      invoiceCount: invoiceRows.length,
      purchaseOrderCount: purchaseOrders.length,
      totalInvoiced,
      outstandingAmount,
      overdueAmount,
    },
    invoices: invoiceRows.slice(0, 8),
    purchaseOrders: purchaseOrders.slice(0, 8),
    payments: recentPayments.slice(0, 8),
  };
}

export async function removeSupplierRole(dbClient: DbClient, companyId: string, id: string) {
  const [existing] = await dbClient
    .select({ id: partner.id, type: partner.type })
    .from(partner)
    .where(and(eq(partner.id, id), eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])))
    .limit(1);
  if (!existing) return null;

  const [updated] = await dbClient
    .update(partner)
    .set({
      type: existing.type === "BOTH" ? "CUSTOMER" : "SUPPLIER",
      isActive: existing.type === "BOTH",
      updatedAt: new Date(),
    })
    .where(and(eq(partner.id, id), eq(partner.companyId, companyId)))
    .returning({ id: partner.id });
  return updated;
}
