import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { item, stockLocation, stockMovement, warehouse } from "@/db/schema";
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
      .select({ name: warehouse.name })
      .from(warehouse)
      .where(and(eq(warehouse.id, id), eq(warehouse.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Almacén ${row.name}` : "Almacén" };
  } catch {
    return { title: "Almacén" };
  }
}

export default async function WarehouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("stock.read");
  const { id } = await params;
  const [record] = await db.select().from(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.companyId, ctx.company.id))).limit(1);
  if (!record) notFound();
  const [locations, movements] = await Promise.all([
    db
      .select({
        id: stockLocation.id,
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        quantity: stockLocation.currentQuantity,
        averageCost: stockLocation.averageCost,
      })
      .from(stockLocation)
      .innerJoin(item, eq(item.id, stockLocation.itemId))
      .where(and(eq(stockLocation.companyId, ctx.company.id), eq(stockLocation.warehouseId, id))),
    db
      .select({
        id: stockMovement.id,
        itemId: item.id,
        itemName: item.name,
        itemSku: item.sku,
        movementType: stockMovement.movementType,
        quantity: stockMovement.quantity,
        reason: stockMovement.reason,
        movedAt: stockMovement.movedAt,
      })
      .from(stockMovement)
      .innerJoin(item, eq(item.id, stockMovement.itemId))
      .where(and(eq(stockMovement.companyId, ctx.company.id), eq(stockMovement.warehouseId, id)))
      .orderBy(desc(stockMovement.movedAt))
      .limit(20),
  ]);
  const quantity = locations.reduce((total, row) => total + Number(row.quantity), 0);
  const value = locations.reduce((total, row) => total + Number(row.quantity) * Number(row.averageCost), 0);
  const currency = ctx.company.baseCurrencyCode;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Almacenes", href: "/inventory/warehouses" },
          { label: record.name },
        ]}
        title={record.name}
        description={record.code}
        actions={
          <>
            {can(ctx.membership.role, "stock.write") ? (
              <Link className={buttonVariants({ variant: "outline" })} href={`/inventory/warehouses/${record.id}/edit`}>
                Editar
              </Link>
            ) : null}
            <Link className={buttonVariants()} href={`/inventory/movements/new?warehouseId=${record.id}`}>
              Nuevo movimiento
            </Link>
          </>
        }
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Referencias" value={locations.length} helper="Artículos con existencias" />
        <MetricCard label="Unidades" value={formatQuantity(quantity)} helper="Stock agregado" />
        <MetricCard label="Valor" value={formatMoney(value, currency)} helper="Valoración por coste medio" />
      </section>
      <PageSection title="Existencias" description="Stock disponible por referencia.">
        {locations.length === 0 ? (
          <EmptyState
            title="Sin existencias"
            description="Este almacén todavía no tiene stock. Registra una entrada con «Nuevo movimiento»."
          />
        ) : (
          <div className="overflow-x-auto rounded-[2px] border border-window-dark-shadow">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artículo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Coste medio</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link className="font-bold hover:underline" href={`/inventory/items/${row.itemId}`}>
                        {row.name}
                        <span className="block font-mono text-xs text-muted-foreground">{row.sku}</span>
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
      <PageSection title="Movimientos recientes" description="Actividad de esta ubicación." contentClassName="space-y-2">
        {movements.length === 0 ? (
          <EmptyState title="Sin movimientos" description="Todavía no hay entradas, salidas ni transferencias en este almacén." />
        ) : (
          movements.map((row) => (
            <Link
              className="grid gap-2 rounded-[2px] border border-window-dark-shadow p-3 text-sm hover:bg-accent sm:grid-cols-[1fr_auto]"
              href={`/inventory/items/${row.itemId}`}
              key={row.id}
            >
              <span>
                <span className="font-bold">{row.itemName}</span>
                <span className="block text-xs text-muted-foreground">
                  {row.itemSku} · {row.reason}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono font-bold tabular-nums">
                  {statusLabel(stockMovementTypeLabels, row.movementType)} · {formatQuantity(row.quantity)}
                </span>
                <span className="text-xs text-muted-foreground">{formatDate(row.movedAt)}</span>
              </span>
            </Link>
          ))
        )}
      </PageSection>
    </PageShell>
  );
}
