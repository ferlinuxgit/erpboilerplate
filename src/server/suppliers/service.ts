import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { purchaseOrder, supplierInvoice, supplierInvoicePayment, supplierPayment, partner } from "@/db/schema";
import type { DbClient } from "@/lib/db";
import { normalizeTaxIdentity } from "@/lib/expense-dedup";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { calculateSupplierBalance } from "@/lib/supplier-balance";
import { reservePartnerNumber } from "@/server/partners/numbers";
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
    taxIdNormalized: normalizeTaxIdentity(input.taxId, input.countryCode),
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
  const [rows, invoiceTotals, paymentTotals] = await Promise.all([
    dbClient
      .select({
        id: partner.id,
        number: partner.number,
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
      .orderBy(desc(partner.createdAt)),
    dbClient
      .select({
        supplierPartnerId: supplierInvoice.supplierPartnerId,
        total: sql<string>`coalesce(sum(${supplierInvoice.totalAmount}), '0')`,
      })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, companyId), ne(supplierInvoice.status, "VOID")))
      .groupBy(supplierInvoice.supplierPartnerId),
    dbClient
      .select({
        supplierPartnerId: supplierPayment.supplierPartnerId,
        total: sql<string>`coalesce(sum(${supplierPayment.amount}), '0')`,
      })
      .from(supplierPayment)
      .where(eq(supplierPayment.companyId, companyId))
      .groupBy(supplierPayment.supplierPartnerId),
  ]);

  const invoicedBySupplier = new Map(invoiceTotals.map((row) => [row.supplierPartnerId, Number(row.total)]));
  const paidBySupplier = new Map(paymentTotals.map((row) => [row.supplierPartnerId, Number(row.total)]));
  return rows.map((row) => {
    const balance = calculateSupplierBalance(invoicedBySupplier.get(row.id) ?? 0, paidBySupplier.get(row.id) ?? 0);
    return {
      ...row,
      outstandingBalance: balance.outstandingBalance.toFixed(2),
      creditBalance: balance.creditBalance.toFixed(2),
    };
  });
}

export async function getSupplier(dbClient: DbClient, companyId: string, id: string) {
  const [row] = await dbClient
    .select({
      id: partner.id,
      number: partner.number,
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
    .where(and(eq(partner.companyId, companyId), eq(partner.countryCode, values.countryCode), eq(partner.taxIdNormalized, values.taxIdNormalized)))
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
        taxIdNormalized: values.taxIdNormalized,
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
      .returning({ id: partner.id, number: partner.number, name: partner.name, email: partner.email, phone: partner.phone, taxId: partner.taxId, city: partner.city, province: partner.province, countryCode: partner.countryCode, isActive: partner.isActive });
    return updated;
  }

  const [created] = await dbClient
    .insert(partner)
    .values({
      companyId,
      number: await reservePartnerNumber(dbClient, companyId, "SUPPLIER"),
      type: "SUPPLIER",
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
      paymentTermsDays: values.paymentTermsDays,
      paymentMethodId: values.paymentMethodId,
      defaultAccountId: values.defaultAccountId,
      currencyCode: values.currencyCode,
      isActive: true,
    })
    .returning({ id: partner.id, number: partner.number, name: partner.name, email: partner.email, phone: partner.phone, taxId: partner.taxId, city: partner.city, province: partner.province, countryCode: partner.countryCode, isActive: partner.isActive });
  return created;
}

export async function updateSupplierWithPartner(dbClient: DbClient, companyId: string, id: string, input: UpdateSupplierInput) {
  const values = supplierValues(input);
  const [duplicate] = await dbClient
    .select({ id: partner.id })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), eq(partner.countryCode, values.countryCode), eq(partner.taxIdNormalized, values.taxIdNormalized), ne(partner.id, id)))
    .limit(1);
  if (duplicate) throw new Error("Ya existe otro tercero con ese CIF/NIF.");

  const [updated] = await dbClient
    .update(partner)
    .set({
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
      paymentTermsDays: values.paymentTermsDays,
      paymentMethodId: values.paymentMethodId,
      defaultAccountId: values.defaultAccountId,
      currencyCode: values.currencyCode,
      isActive: values.isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(partner.id, id), eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])))
    .returning({ id: partner.id, number: partner.number, name: partner.name, email: partner.email, phone: partner.phone, taxId: partner.taxId, city: partner.city, province: partner.province, countryCode: partner.countryCode, isActive: partner.isActive });
  return updated;
}

export async function getSupplierActivity(dbClient: DbClient, companyId: string, supplierId: string) {
  const [invoices, payments, purchaseOrders] = await Promise.all([
    dbClient
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        purchaseOrderId: supplierInvoice.purchaseOrderId,
        purchaseOrderNumber: purchaseOrder.number,
        issueDate: supplierInvoice.issueDate,
        dueDate: supplierInvoice.dueDate,
        paymentStatus: supplierInvoice.paymentStatus,
        totalAmount: supplierInvoice.totalAmount,
      })
      .from(supplierInvoice)
      .leftJoin(purchaseOrder, eq(purchaseOrder.id, supplierInvoice.purchaseOrderId))
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
    const outstandingAmount = invoice.paymentStatus === "VOID" ? 0 : Math.max(totalAmount - paidAmount, 0);
    return { ...invoice, totalAmount, paidAmount, outstandingAmount };
  });

  const balanceInvoices = invoiceRows.filter((invoice) => invoice.paymentStatus !== "VOID");
  const totalInvoiced = balanceInvoices.reduce((total, invoice) => total + invoice.totalAmount, 0);
  const allocatedAmount = balanceInvoices.reduce((total, invoice) => total + invoice.paidAmount, 0);
  const rawOverdueAmount = balanceInvoices
    .filter((invoice) => invoice.dueDate && invoice.dueDate.getTime() < Date.now() && invoice.outstandingAmount > 0)
    .reduce((total, invoice) => total + invoice.outstandingAmount, 0);

  const recentPayments = await dbClient
    .select({
      id: supplierPayment.id,
      number: supplierPayment.number,
      supplierInvoiceId: supplierPayment.supplierInvoiceId,
      amount: supplierPayment.amount,
      postedAt: supplierPayment.postedAt,
    })
    .from(supplierPayment)
    .where(and(eq(supplierPayment.companyId, companyId), eq(supplierPayment.supplierPartnerId, supplierId)))
    .orderBy(desc(supplierPayment.postedAt));

  const totalPaid = recentPayments.reduce((total, payment) => total + Number(payment.amount), 0);
  const unappliedAmount = Math.max(totalPaid - allocatedAmount, 0);
  const balance = calculateSupplierBalance(totalInvoiced, totalPaid);

  return {
    metrics: {
      invoiceCount: invoiceRows.length,
      purchaseOrderCount: purchaseOrders.length,
      totalInvoiced,
      totalPaid,
      outstandingAmount: balance.outstandingBalance,
      creditBalance: balance.creditBalance,
      overdueAmount: Math.max(rawOverdueAmount - unappliedAmount, 0),
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
