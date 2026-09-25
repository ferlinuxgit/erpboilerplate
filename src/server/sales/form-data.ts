import { and, asc, eq } from "drizzle-orm";

import { customer, partner, tax } from "@/db/schema";
import { db } from "@/lib/db";
import { defaultVatRate } from "@/server/invoices/default-taxes";

/**
 * Datos comunes de los formularios de presupuesto y pedido: clientes activos (con su retención
 * habitual) e IVA por defecto (el impuesto predeterminado o el 21 %, nunca el de menor tipo).
 */
export async function loadSalesFormData(companyId: string, options: { includeCustomerId?: string } = {}) {
  const [customers, taxes] = await Promise.all([
    db
      .select({ id: customer.id, number: partner.number, name: customer.name, status: customer.status, defaultRetentionRate: customer.defaultRetentionRate })
      .from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(eq(customer.companyId, companyId))
      .orderBy(asc(customer.name)),
    db
      .select({ id: tax.id, rate: tax.rate, kind: tax.kind, operation: tax.operation, isDefault: tax.isDefault, isActive: tax.isActive })
      .from(tax)
      .where(and(eq(tax.companyId, companyId), eq(tax.isActive, true))),
  ]);
  return {
    customers: customers
      .filter((row) => row.status === "ACTIVE" || row.id === options.includeCustomerId)
      .map((row) => ({ id: row.id, number: row.number, name: row.name, defaultRetentionRate: row.defaultRetentionRate === null ? null : Number(row.defaultRetentionRate) })),
    defaultTaxRate: defaultVatRate(taxes),
  };
}
