import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { item, itemCostHistory, stockLocation, stockMovement, warehouse } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { statusLabel, stockMovementTypeLabels } from "@/lib/status-labels";

function formatQuantity(value: number | string) {
  return Number(value).toLocaleString("es-ES", { maximumFractionDigits: 3 });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("stock.read");
    const { id } = await params;
    const [row] = await db
      .select({ name: item.name })
      .from(item)
      .where(and(eq(item.id, id), eq(item.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Artículo ${row.name}` : "Artículo" };
  } catch {
    return { title: "Artículo" };
  }
}

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("stock.read");
  const { id } = await params;
  const [record] = await db.select().from(item).where(and(eq(item.id, id), eq(item.companyId, ctx.company.id))).limit(1);
  if (!record) notFound();
  const [locations, movements, costs] = await Promise.all([
    db
      .select({
        id: stockLocation.id,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        quantity: stockLocation.currentQuantity,
        averageCost: stockLocation.averageCost,
      })
      .from(stockLocation)
      .innerJoin(warehouse, eq(warehouse.id, stockLocation.warehouseId))
      .where(and(eq(stockLocation.companyId, ctx.company.id), eq(stockLocation.itemId, id))),
    db
      .select({
        id: stockMovement.id,
        movementType: stockMovement.movementType,
        quantity: stockMovement.quantity,
        movedAt: stockMovement.movedAt,
        reason: stockMovement.reason,
        reference: stockMovement.reference,
        warehouseName: warehouse.name,
      })
      .from(stockMovement)
      .innerJoin(warehouse, eq(warehouse.id, stockMovement.warehouseId))
      .where(and(eq(stockMovement.companyId, ctx.company.id), eq(stockMovement.itemId, id)))
      .orderBy(desc(stockMovement.movedAt))
      .limit(20),
    db
      .select()
      .from(itemCostHistory)
      .where(and(eq(itemCostHistory.companyId, ctx.company.id), eq(itemCostHistory.itemId, id)))
      .orderBy(desc(itemCostHistory.createdAt))
      .limit(10),
  ]);
  const quantity = locations.reduce((total, row) => total + Number(row.quantity), 0);
  const inventoryValue = locations.reduce((total, row) => total + Number(row.quantity) * Number(row.averageCost), 0);
  const currency = ctx.company.baseCurrencyCode;
  const canWrite = can(ctx.membership.role, "stock.write");
  const lowStock = !record.isService && quantity <= Number(record.minimumStock);

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Artículos", href: "/inventory/items" },
          { label: record.name },
        ]}
        title={record.name}
        description={record.sku}
        meta={
          <StatusBadge tone={record.isService ? "info" : lowStock ? "warning" : "success"}>
            {record.isService ? "Servicio" : lowStock ? "Stock bajo" : "Disponible"}
          </StatusBadge>
        }
        actions={
          <>
            {canWrite ? (
              <Link className={buttonVariants({ variant: "outline" })} href={`/inventory/items/${record.id}/edit`}>
                Editar
              </Link>
            ) : null}
            {!record.isService ? (
              <Link className={buttonVariants()} href={`/inventory/movements/new?itemId=${record.id}`}>
                Nuevo movimiento
              </Link>
            ) : null}
          </>
        }
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="Stock total"
          value={record.isService ? "—" : formatQuantity(quantity)}
          helper={`Mínimo ${formatQuantity(record.minimumStock)}`}
          tone={lowStock ? "warning" : "neutral"}
        />
        <MetricCard label="Valor de stock" value={formatMoney(inventoryValue, currency)} helper="Cantidad × coste medio" />
        <MetricCard label="Precio de venta" value={formatMoney(record.salePrice, currency)} helper="Precio por defecto" />
        <MetricCard label="Coste medio" value={formatMoney(record.averageCost, currency)} helper={`${costs.length} actualizaciones recientes`} />
      </section>
      <PageSection title="Existencias por almacén" description="Cantidad y valoración en cada ubicación.">
        {locations.length === 0 ? (
          <EmptyState
            title="Sin existencias registradas"
            description={record.isService ? "Los servicios no mantienen existencias en almacén." : "Registra una entrada para dar de alta stock de este artículo."}
          />
        ) : (
          <div className="overflow-x-auto rounded-[2px] border border-window-dark-shadow">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Almacén</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Coste medio</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link className="font-bold hover:underline" href={`/inventory/warehouses/${row.warehouseId}`}>
                        {row.warehouseCode} · {row.warehouseName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatQuantity(row.quantity)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(row.averageCost, currency)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(Number(row.quantity) * Number(row.averageCost), currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageSection>
      <PageSection title="Movimientos recientes" description="Trazabilidad de entradas, salidas, ajustes y transferencias." contentClassName="space-y-2">
        {movements.length === 0 ? (
          <EmptyState
            title="Sin movimientos"
            description={record.isService ? "Los servicios no generan movimientos de stock." : "Todavía no hay entradas, salidas ni ajustes para este artículo."}
          />
        ) : (
          movements.map((row) => (
            <div className="grid gap-2 rounded-[2px] border border-window-dark-shadow p-3 text-sm sm:grid-cols-[auto_1fr_auto]" key={row.id}>
              <StatusBadge tone={row.movementType === "OUT" ? "warning" : "success"}>{statusLabel(stockMovementTypeLabels, row.movementType)}</StatusBadge>
              <div>
                <p className="font-bold">{row.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {row.warehouseName}
                  {row.reference ? ` · ${row.reference}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono font-bold tabular-nums">{formatQuantity(row.quantity)}</p>
                <p className="text-xs text-muted-foreground">{formatDate(row.movedAt)}</p>
              </div>
            </div>
          ))
        )}
      </PageSection>
    </PageShell>
  );
}
