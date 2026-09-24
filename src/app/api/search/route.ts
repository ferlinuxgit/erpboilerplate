import { and, eq, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  bankAccount,
  bankTransaction,
  customer,
  deliveryNote,
  invoice,
  item,
  journalEntry,
  partner,
  purchaseOrder,
  salesOrder,
  salesQuote,
  supplierInvoice,
} from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { escapeLike } from "@/server/lists/paginate";

type SearchResult = { href: string; label: string; description: string; type: string; score: number };

const PER_TYPE_LIMIT = 5;
const TOTAL_LIMIT = 20;

/**
 * Relevance of a row for the query: exact match of the key field (number, SKU, NIF…) 100,
 * key field starting with the query 80, a word of the name starting with it 60, any other
 * substring 40. Computed in SQL so each type returns its best rows, not the first ones found.
 */
function rankExpression(query: string, exact: Array<AnyColumn | SQL>, text: Array<AnyColumn | SQL>) {
  const lowered = query.toLocaleLowerCase("es-ES");
  const prefix = `${escapeLike(query)}%`;
  const wordPrefix = `% ${escapeLike(query)}%`;
  const cases: SQL[] = [
    ...exact.map((column) => sql`when lower(${column}) = ${lowered} then 100`),
    ...[...exact, ...text].map((column) => sql`when ${column} ilike ${prefix} then 80`),
    ...text.map((column) => sql`when ${column} ilike ${wordPrefix} then 60`),
  ];
  return sql<number>`case ${sql.join(cases, sql` `)} else 40 end`.mapWith(Number);
}

/** Every column matched with a single escaped ILIKE pattern (company filter first, so the company indexes apply). */
function matches(query: string, columns: Array<AnyColumn | SQL>) {
  const pattern = `%${escapeLike(query)}%`;
  return or(...columns.map((column) => sql`${column} ilike ${pattern}`));
}

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const query = new URL(request.url).searchParams.get("q")?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });
  const companyId = ctx.company.id;
  const role = ctx.membership.role;

  const searches: Array<Promise<SearchResult[]>> = [];

  if (can(role, "invoice.read")) {
    const rank = rankExpression(query, [invoice.number], [customer.name]);
    searches.push(db.select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      invoiceType: invoice.invoiceType,
      customerName: customer.name,
      rank,
    })
      .from(invoice)
      .innerJoin(customer, eq(customer.id, invoice.customerId))
      .where(and(eq(invoice.companyId, companyId), matches(query, [invoice.number, customer.name])))
      .orderBy(sql`${rank} desc`, sql`${invoice.issueDate} desc`)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => {
        // Drafts only have a provisional code (BORRADOR-…): label them as drafts, not by that code.
        const lifecycle = invoiceLifecycle(row);
        const isCreditNote = row.invoiceType === "CREDIT_NOTE";
        return {
          href: `/invoices/${row.id}`,
          label: lifecycle === "DRAFT" ? (isCreditNote ? "Borrador de rectificativa" : "Borrador de factura") : row.number,
          description: [row.customerName, lifecycle === "DRAFT" ? "Sin emitir" : isCreditNote ? "Rectificativa" : null, lifecycle === "VOID" ? "Anulada" : null]
            .filter(Boolean)
            .join(" · "),
          type: "Facturas",
          score: row.rank + 5,
        };
      })));
  }

  if (can(role, "customer.read")) {
    const rank = rankExpression(query, [partner.number, partner.taxId], [customer.name, customer.email]);
    searches.push(db.select({ id: customer.id, number: partner.number, name: customer.name, email: customer.email, rank })
      .from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(customer.companyId, companyId), matches(query, [partner.number, partner.taxId, customer.name, customer.email])))
      .orderBy(sql`${rank} desc`, customer.name)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => ({ href: `/customers/${row.id}`, label: row.name, description: [row.number, row.email].filter(Boolean).join(" · ") || "Cliente", type: "Clientes", score: row.rank + 4 }))));
  }

  if (can(role, "supplier.read")) {
    const rank = rankExpression(query, [partner.number, partner.taxId], [partner.name]);
    searches.push(db.select({ id: partner.id, number: partner.number, name: partner.name, taxId: partner.taxId, rank })
      .from(partner)
      .where(and(eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"]), matches(query, [partner.number, partner.name, partner.taxId])))
      .orderBy(sql`${rank} desc`, partner.name)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => ({ href: `/suppliers/${row.id}`, label: row.name, description: [row.number, row.taxId].filter(Boolean).join(" · ") || "Proveedor", type: "Proveedores", score: row.rank + 4 }))));
  }

  if (can(role, "expense.read")) {
    const rank = rankExpression(query, [supplierInvoice.number, supplierInvoice.supplierDocumentNumber], [partner.name]);
    searches.push(db.select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      supplierName: partner.name,
      rank,
    })
      .from(supplierInvoice)
      .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .where(and(eq(supplierInvoice.companyId, companyId), matches(query, [supplierInvoice.number, supplierInvoice.supplierDocumentNumber, partner.name])))
      .orderBy(sql`${rank} desc`, sql`${supplierInvoice.issueDate} desc`)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => ({
        href: `/expenses/${row.id}`,
        label: row.supplierDocumentNumber || row.number,
        description: [row.supplierName, row.supplierDocumentNumber ? row.number : null].filter(Boolean).join(" · "),
        type: "Facturas de proveedor",
        score: row.rank + 3,
      }))));
  }

  if (can(role, "stock.read")) {
    const rank = rankExpression(query, [item.sku], [item.name]);
    searches.push(db.select({ id: item.id, name: item.name, sku: item.sku, rank })
      .from(item)
      .where(and(eq(item.companyId, companyId), eq(item.isActive, true), matches(query, [item.name, item.sku])))
      .orderBy(sql`${rank} desc`, item.name)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => ({ href: `/inventory/items/${row.id}`, label: row.name, description: row.sku, type: "Artículos", score: row.rank + 3 }))));
  }

  if (can(role, "invoice.read")) {
    const salesDocuments = [
      { table: salesQuote, href: "/sales/quotes", type: "Presupuestos" },
      { table: salesOrder, href: "/sales/orders", type: "Pedidos" },
      { table: deliveryNote, href: "/sales/delivery-notes", type: "Albaranes" },
    ] as const;
    for (const document of salesDocuments) {
      const rank = rankExpression(query, [document.table.number], [customer.name]);
      searches.push(db.select({ id: document.table.id, number: document.table.number, customerName: customer.name, rank })
        .from(document.table)
        .innerJoin(customer, eq(customer.id, document.table.customerId))
        .where(and(eq(document.table.companyId, companyId), matches(query, [document.table.number, customer.name])))
        .orderBy(sql`${rank} desc`, sql`${document.table.createdAt} desc`)
        .limit(PER_TYPE_LIMIT)
        .then((rows) => rows.map((row) => ({ href: `${document.href}/${row.id}`, label: row.number, description: row.customerName, type: document.type, score: row.rank }))));
    }
  }

  if (can(role, "purchase.read")) {
    const rank = rankExpression(query, [purchaseOrder.number], [partner.name]);
    searches.push(db.select({ id: purchaseOrder.id, number: purchaseOrder.number, supplierName: partner.name, rank })
      .from(purchaseOrder)
      .innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId))
      .where(and(eq(purchaseOrder.companyId, companyId), matches(query, [purchaseOrder.number, partner.name])))
      .orderBy(sql`${rank} desc`, sql`${purchaseOrder.createdAt} desc`)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => ({ href: `/purchases/orders/${row.id}`, label: row.number, description: row.supplierName, type: "Compras", score: row.rank }))));
  }

  if (can(role, "treasury.read")) {
    const rank = rankExpression(query, [sql`${bankTransaction.amount}::text`], [bankTransaction.description, bankAccount.bankName]);
    searches.push(db.select({ id: bankTransaction.id, description: bankTransaction.description, amount: bankTransaction.amount, bankName: bankAccount.bankName, rank })
      .from(bankTransaction)
      .innerJoin(bankAccount, eq(bankAccount.id, bankTransaction.bankAccountId))
      .where(and(eq(bankAccount.companyId, companyId), matches(query, [bankTransaction.description, sql`${bankTransaction.amount}::text`, bankAccount.bankName])))
      .orderBy(sql`${rank} desc`, sql`${bankTransaction.postedAt} desc`)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => ({ href: `/treasury/bank-transactions/${row.id}`, label: row.description, description: `${row.bankName} · ${row.amount}`, type: "Tesorería", score: row.rank - 5 }))));
  }

  if (can(role, "accounting.read")) {
    const rank = rankExpression(query, [journalEntry.number], [journalEntry.reference]);
    searches.push(db.select({ id: journalEntry.id, number: journalEntry.number, reference: journalEntry.reference, sourceType: journalEntry.sourceType, rank })
      .from(journalEntry)
      .where(and(eq(journalEntry.companyId, companyId), matches(query, [journalEntry.number, journalEntry.reference])))
      .orderBy(sql`${rank} desc`, sql`${journalEntry.postedAt} desc`)
      .limit(PER_TYPE_LIMIT)
      .then((rows) => rows.map((row) => ({ href: `/accounting/entries/${row.id}`, label: row.number, description: row.reference ?? row.sourceType ?? "Asiento manual", type: "Contabilidad", score: row.rank - 5 }))));
  }

  // Best matches first across types; ties keep the type order above (invoices, customers, suppliers…).
  const results = (await Promise.all(searches))
    .flatMap((group, groupIndex) => group.map((result, index) => ({ result, groupIndex, index })))
    .sort((left, right) => right.result.score - left.result.score || left.groupIndex - right.groupIndex || left.index - right.index)
    .slice(0, TOTAL_LIMIT)
    .map(({ result }) => ({ href: result.href, label: result.label, description: result.description, type: result.type }));
  return NextResponse.json({ results });
}
