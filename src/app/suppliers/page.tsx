import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";

import { SuppliersTable } from "@/components/suppliers/suppliers-table";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { partner, supplierInvoice, supplierPayment } from "@/db/schema";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { canManageSuppliers } from "@/lib/rbac";
import {
  countRows,
  listOrderBy,
  listWhere,
  paginate,
  toServerListState,
  unfilteredTotal,
  windowCount,
  windowTotals,
} from "@/server/lists/paginate";

export const metadata: Metadata = { title: "Proveedores" };

const supplierListConfig = {
  sortKeys: ["recent", "number", "name", "status", "outstanding", "type", "taxId", "address", "email", "phone"] as const,
  // Newest first: a just-created supplier is always on page 1.
  defaultSort: { key: "recent" as const, dir: "desc" as const },
  filters: { status: ["ACTIVE", "INACTIVE"], type: ["SUPPLIER", "BOTH"] },
};

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUserSession();
  const tenantContext = await requireContext("supplier.read");
  const companyId = tenantContext.company.id;
  const params = parseListParams(await searchParams, supplierListConfig);

  // Balances aggregated once per supplier (same rules as listSuppliers: non-void invoices minus payments).
  const invoicedBySupplier = db
    .select({
      supplierPartnerId: supplierInvoice.supplierPartnerId,
      invoiced: sql<string>`coalesce(sum(${supplierInvoice.totalAmount}), 0)`.as("invoiced"),
    })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.companyId, companyId), ne(supplierInvoice.status, "VOID")))
    .groupBy(supplierInvoice.supplierPartnerId)
    .as("invoiced_by_supplier");
  const paidBySupplier = db
    .select({
      supplierPartnerId: supplierPayment.supplierPartnerId,
      paid: sql<string>`coalesce(sum(${supplierPayment.amount}), 0)`.as("paid"),
    })
    .from(supplierPayment)
    .where(eq(supplierPayment.companyId, companyId))
    .groupBy(supplierPayment.supplierPartnerId)
    .as("paid_by_supplier");

  const netBalance = sql`(coalesce(${invoicedBySupplier.invoiced}, 0) - coalesce(${paidBySupplier.paid}, 0))`;
  const outstanding = sql`greatest(${netBalance}, 0)`;
  const credit = sql`greatest(-${netBalance}, 0)`;

  const where = listWhere({
    base: [eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])],
    search: {
      q: params.q,
      columns: [
        partner.name,
        partner.number,
        partner.taxId,
        partner.city,
        partner.province,
        partner.email,
        partner.phone,
        sql`${outstanding}::text`,
        sql`${credit}::text`,
      ],
    },
    filters: [
      params.filters.status ? eq(partner.isActive, params.filters.status === "ACTIVE") : undefined,
      params.filters.type ? eq(partner.type, params.filters.type as "SUPPLIER" | "BOTH") : undefined,
    ],
  });
  const sortColumns = {
    recent: partner.createdAt,
    number: partner.number,
    name: partner.name,
    // Same order as the client list: "ACTIVE" before "INACTIVE" when ascending.
    status: sql`not ${partner.isActive}`,
    outstanding,
    type: partner.type,
    taxId: partner.taxId,
    address: sql`concat_ws(' ', ${partner.city}, ${partner.province}, ${partner.countryCode})`,
    email: partner.email,
    phone: partner.phone,
  };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: partner.id,
          number: partner.number,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          taxId: partner.taxId,
          postalCode: partner.postalCode,
          city: partner.city,
          province: partner.province,
          countryCode: partner.countryCode,
          currencyCode: partner.currencyCode,
          type: partner.type,
          isActive: partner.isActive,
          outstandingBalance: sql<string>`round(${outstanding}, 2)::text`,
          creditBalance: sql<string>`round(${credit}, 2)::text`,
          total: windowCount(),
          ...windowTotals({ sumOutstanding: outstanding }),
          minCurrency: sql<string | null>`min(${partner.currencyCode}) over()`,
          maxCurrency: sql<string | null>`max(${partner.currencyCode}) over()`,
        })
        .from(partner)
        .leftJoin(invoicedBySupplier, eq(invoicedBySupplier.supplierPartnerId, partner.id))
        .leftJoin(paidBySupplier, eq(paidBySupplier.supplierPartnerId, partner.id))
        .where(where)
        .orderBy(...listOrderBy(sortColumns, params, partner.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db
          .select({ value: count() })
          .from(partner)
          .leftJoin(invoicedBySupplier, eq(invoicedBySupplier.supplierPartnerId, partner.id))
          .leftJoin(paidBySupplier, eq(paidBySupplier.supplierPartnerId, partner.id))
          .where(where),
      ),
  });
  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(
      db
        .select({ value: count() })
        .from(partner)
        .where(and(eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"]))),
    ),
  );

  const canCreateSupplier = canManageSuppliers(tenantContext.membership.role);
  const firstRow = result.rows[0];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Proveedores"
        description={`Terceros proveedores de ${tenantContext.company.name} para compras, gastos y facturas recibidas.`}
        meta={<StatusBadge tone="neutral">Rol: {statusLabel(roleLabels, tenantContext.membership.role)}</StatusBadge>}
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={
          canCreateSupplier ? (
            <Link className={buttonVariants()} href="/suppliers/new">
              Nuevo proveedor
            </Link>
          ) : null
        }
      />

      <PageSection
        title="Proveedores registrados"
        description="Abre un proveedor para editar su identidad fiscal, contacto y domicilio."
      >
        <SuppliersTable
          rows={result.rows}
          server={toServerListState(params, result, recordCount)}
          totals={
            firstRow
              ? {
                  outstandingBalance: firstRow.sumOutstanding,
                  currencyCode: firstRow.minCurrency === firstRow.maxCurrency ? firstRow.minCurrency : null,
                }
              : { outstandingBalance: 0, currencyCode: tenantContext.company.baseCurrencyCode }
          }
        />
      </PageSection>
    </PageShell>
  );
}
