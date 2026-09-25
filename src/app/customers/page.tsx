import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";

import { CustomersTable } from "@/components/customers/customers-table";
import { customer, customerStatusEnum, deliveryNote, invoice, partner, salesOrder, salesQuote } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { roleLabels, statusLabel } from "@/lib/status-labels";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { canManageCustomers } from "@/lib/rbac";
import {
  countRows,
  listOrderBy,
  listWhere,
  paginate,
  toServerListState,
  unfilteredTotal,
  windowCount,
} from "@/server/lists/paginate";

export const metadata: Metadata = { title: "Clientes" };

const customerSortKeys = ["recent", "number", "name", "status", "taxId", "address", "email", "phone"] as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireUserSession();
  const tenantContext = await requireContext("customer.read");
  const companyId = tenantContext.company.id;

  // Country filter options come from the whole customer base, not only the current page.
  const [rawParams, countryRows] = await Promise.all([
    searchParams,
    db
      .selectDistinct({ countryCode: partner.countryCode })
      .from(customer)
      .innerJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(customer.companyId, companyId), isNotNull(partner.countryCode)))
      .orderBy(asc(partner.countryCode)),
  ]);
  const countryOptions = countryRows.map((row) => row.countryCode).filter(Boolean);

  const params = parseListParams(rawParams, {
    sortKeys: customerSortKeys,
    // Newest first: a just-created customer is always on page 1.
    defaultSort: { key: "recent", dir: "desc" },
    filters: { status: customerStatusEnum.enumValues, country: countryOptions },
  });

  const where = listWhere({
    base: [eq(customer.companyId, companyId)],
    search: {
      q: params.q,
      columns: [
        customer.name,
        partner.number,
        sql`${customer.status}::text`,
        partner.taxId,
        partner.city,
        partner.province,
        customer.email,
        customer.phone,
      ],
    },
    filters: [
      params.filters.status
        ? eq(customer.status, params.filters.status as (typeof customerStatusEnum.enumValues)[number])
        : undefined,
      params.filters.country ? eq(partner.countryCode, params.filters.country) : undefined,
    ],
  });
  const sortColumns = {
    recent: customer.createdAt,
    number: partner.number,
    name: customer.name,
    status: customer.status,
    taxId: partner.taxId,
    address: sql`concat_ws(' ', ${partner.city}, ${partner.province}, ${partner.countryCode})`,
    email: customer.email,
    phone: customer.phone,
  };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: customer.id,
          number: partner.number,
          name: customer.name,
          status: customer.status,
          email: customer.email,
          phone: customer.phone,
          taxId: partner.taxId,
          postalCode: partner.postalCode,
          city: partner.city,
          province: partner.province,
          countryCode: partner.countryCode,
          // Con documentos no se puede eliminar (solo marcar como inactivo): se indica en el menú.
          hasDocuments: sql<boolean>`(
            exists (select 1 from ${invoice} where ${invoice.customerId} = ${customer.id})
            or exists (select 1 from ${salesQuote} where ${salesQuote.customerId} = ${customer.id})
            or exists (select 1 from ${salesOrder} where ${salesOrder.customerId} = ${customer.id})
            or exists (select 1 from ${deliveryNote} where ${deliveryNote.customerId} = ${customer.id})
          )`,
          total: windowCount(),
        })
        .from(customer)
        .leftJoin(partner, eq(partner.id, customer.partnerId))
        .where(where)
        .orderBy(...listOrderBy(sortColumns, params, customer.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db.select({ value: count() }).from(customer).leftJoin(partner, eq(partner.id, customer.partnerId)).where(where),
      ),
  });
  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(customer).where(eq(customer.companyId, companyId))),
  );

  const canCreateCustomer = canManageCustomers(tenantContext.membership.role);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operación"
        title="Clientes"
        description={`Cartera comercial de ${tenantContext.company.name}.`}
        meta={<StatusBadge tone="neutral">Rol: {statusLabel(roleLabels, tenantContext.membership.role)}</StatusBadge>}
        backHref="/dashboard"
        backLabel="Volver al panel"
        actions={
          canCreateCustomer ? (
            <Link className={buttonVariants()} href="/customers/new">
              Nuevo cliente
            </Link>
          ) : null
        }
      />

      <PageSection
        title="Clientes registrados"
        description="Abre un cliente para ver lo que te debe, sus facturas y sus condiciones de pago."
      >
        <CustomersTable
          countryOptions={countryOptions}
          rows={result.rows.map((row) => ({ ...row, hasDocuments: Boolean(row.hasDocuments) }))}
          server={toServerListState(params, result, recordCount)}
        />
      </PageSection>
    </PageShell>
  );
}
