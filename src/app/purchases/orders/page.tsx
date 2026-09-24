import type { Metadata } from "next";
import Link from "next/link";
import { count, eq } from "drizzle-orm";

import { PurchaseOrdersList } from "@/components/purchases/purchase-orders-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { partner, purchaseOrder } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
import { purchaseOrderStatusLabels } from "@/lib/status-labels";
import {
  countRows,
  listOrderBy,
  listWhere,
  paginate,
  toServerListState,
  unfilteredTotal,
  windowCount,
} from "@/server/lists/paginate";

export const metadata: Metadata = { title: "Pedidos de compra" };

const purchaseOrderListConfig = {
  sortKeys: ["createdAt", "number", "supplier", "status"] as const,
  // Newest first: a just-created purchase order is always on page 1.
  defaultSort: { key: "createdAt" as const, dir: "desc" as const },
  // purchase_order.status is free text: only known statuses reach SQL.
  filters: { status: Object.keys(purchaseOrderStatusLabels) },
};

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("purchase.read");
  const companyId = ctx.company.id;
  const params = parseListParams(await searchParams, purchaseOrderListConfig);

  const where = listWhere({
    base: [eq(purchaseOrder.companyId, companyId)],
    search: { q: params.q, columns: [purchaseOrder.number, partner.name, purchaseOrder.status] },
    dateRange: { column: purchaseOrder.createdAt, from: params.from, to: params.to },
    filters: [params.filters.status ? eq(purchaseOrder.status, params.filters.status) : undefined],
  });
  const sortColumns = {
    createdAt: purchaseOrder.createdAt,
    number: purchaseOrder.number,
    supplier: partner.name,
    status: purchaseOrder.status,
  };

  const result = await paginate({
    page: params.page,
    pageSize: params.pageSize,
    fetchPage: (limit, offset) =>
      db
        .select({
          id: purchaseOrder.id,
          number: purchaseOrder.number,
          status: purchaseOrder.status,
          supplierName: partner.name,
          createdAt: purchaseOrder.createdAt,
          total: windowCount(),
        })
        .from(purchaseOrder)
        .innerJoin(partner, eq(purchaseOrder.supplierPartnerId, partner.id))
        .where(where)
        .orderBy(...listOrderBy(sortColumns, params, purchaseOrder.id))
        .limit(limit)
        .offset(offset),
    countAll: () =>
      countRows(
        db
          .select({ value: count() })
          .from(purchaseOrder)
          .innerJoin(partner, eq(purchaseOrder.supplierPartnerId, partner.id))
          .where(where),
      ),
  });
  const recordCount = await unfilteredTotal(params, result.total, () =>
    countRows(db.select({ value: count() }).from(purchaseOrder).where(eq(purchaseOrder.companyId, companyId))),
  );

  const canWrite = can(ctx.membership.role, "purchase.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Pedidos de compra"
        title="Pedidos de compra"
        description="Solicitudes a proveedores, importes acordados y estado de recepción."
        actions={
          canWrite ? (
            <Link className={buttonVariants()} href="/purchases/orders/new">
              Nuevo pedido de compra
            </Link>
          ) : null
        }
      />
      <PageSection
        title="Pedidos"
        description="Filtra por estado y abre cada pedido para revisar líneas o registrar una recepción."
      >
        <PurchaseOrdersList
          canManage={canWrite}
          rows={result.rows}
          server={toServerListState(params, result, recordCount)}
        />
      </PageSection>
    </PageShell>
  );
}
