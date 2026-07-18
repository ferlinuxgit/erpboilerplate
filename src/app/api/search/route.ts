import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, invoice, item, partner, purchaseOrder, salesQuote } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";

type SearchResult = { href: string; label: string; description: string; type: string };

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });
  const pattern = `%${query}%`;

  const searches: Array<Promise<SearchResult[]>> = [];

  if (can(ctx.membership.role, "customer.read")) {
    searches.push(db.select({ id: customer.id, name: customer.name, email: customer.email })
      .from(customer)
      .where(and(eq(customer.companyId, ctx.company.id), or(ilike(customer.name, pattern), ilike(customer.email, pattern))))
      .limit(5)
      .then((rows) => rows.map((row) => ({ href: `/customers/${row.id}`, label: row.name, description: row.email ?? "Cliente", type: "Clientes" }))));
  }

  if (can(ctx.membership.role, "supplier.read")) {
    searches.push(db.select({ id: partner.id, name: partner.name, taxId: partner.taxId })
      .from(partner)
      .where(and(eq(partner.companyId, ctx.company.id), inArray(partner.type, ["SUPPLIER", "BOTH"]), or(ilike(partner.name, pattern), ilike(partner.taxId, pattern))))
      .limit(5)
      .then((rows) => rows.map((row) => ({ href: `/suppliers/${row.id}`, label: row.name, description: row.taxId ?? "Proveedor", type: "Proveedores" }))));
  }

  if (can(ctx.membership.role, "invoice.read")) {
    searches.push(db.select({ id: invoice.id, number: invoice.number, customerName: customer.name })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .where(and(eq(invoice.companyId, ctx.company.id), or(ilike(invoice.number, pattern), ilike(customer.name, pattern))))
      .limit(5)
      .then((rows) => rows.map((row) => ({ href: `/invoices/${row.id}`, label: row.number, description: row.customerName, type: "Facturas" }))));

    searches.push(db.select({ id: salesQuote.id, number: salesQuote.number, customerName: customer.name })
      .from(salesQuote)
      .innerJoin(customer, eq(customer.id, salesQuote.customerId))
      .where(and(eq(salesQuote.companyId, ctx.company.id), or(ilike(salesQuote.number, pattern), ilike(customer.name, pattern))))
      .limit(5)
      .then((rows) => rows.map((row) => ({ href: `/sales/quotes/${row.id}`, label: row.number, description: row.customerName, type: "Presupuestos" }))));
  }

  if (can(ctx.membership.role, "purchase.read")) {
    searches.push(db.select({ id: purchaseOrder.id, number: purchaseOrder.number, supplierName: partner.name })
      .from(purchaseOrder)
      .innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId))
      .where(and(eq(purchaseOrder.companyId, ctx.company.id), or(ilike(purchaseOrder.number, pattern), ilike(partner.name, pattern))))
      .limit(5)
      .then((rows) => rows.map((row) => ({ href: `/purchases/${row.id}`, label: row.number, description: row.supplierName, type: "Compras" }))));
  }

  if (can(ctx.membership.role, "stock.read")) {
    searches.push(db.select({ id: item.id, name: item.name, sku: item.sku })
      .from(item)
      .where(and(eq(item.companyId, ctx.company.id), or(ilike(item.name, pattern), ilike(item.sku, pattern))))
      .limit(5)
      .then((rows) => rows.map((row) => ({ href: `/inventory/items/${row.id}`, label: row.name, description: row.sku, type: "Artículos" }))));
  }

  const results = (await Promise.all(searches)).flat().slice(0, 20);
  return NextResponse.json({ results });
}
