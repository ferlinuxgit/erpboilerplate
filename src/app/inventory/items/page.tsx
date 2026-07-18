import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { ItemsList } from "@/components/inventory/items-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { item, stockLocation } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";

export default async function InventoryItemsPage() {
  const ctx = await requireContext("stock.read"); const [items, locations] = await Promise.all([db.select().from(item).where(eq(item.companyId, ctx.company.id)).orderBy(asc(item.name)), db.select({ itemId: stockLocation.itemId, quantity: stockLocation.currentQuantity }).from(stockLocation).where(eq(stockLocation.companyId, ctx.company.id))]);
  const quantityByItem = locations.reduce<Record<string, number>>((result, row) => { result[row.itemId] = (result[row.itemId] ?? 0) + Number(row.quantity); return result; }, {}); const canManage = can(ctx.membership.role, "stock.write"); const products = items.filter((row) => !row.isService); const services = items.length - products.length;
  return <PageShell><PageHeader eyebrow="Inventario" title="Artículos" description="Catálogo operativo de productos y servicios, precios, costes y niveles mínimos." backHref="/inventory" backLabel="Volver a inventario" actions={canManage ? <Link className={buttonVariants()} href="/inventory/items/new">Nuevo artículo</Link> : null} /><section className="grid gap-3 md:grid-cols-3"><MetricCard label="Productos" value={products.length} helper="Con control de existencias" /><MetricCard label="Servicios" value={services} helper="Sin movimiento de stock" /><MetricCard label="Unidades" value={Object.values(quantityByItem).reduce((total, value) => total + value, 0).toLocaleString("es-ES", { maximumFractionDigits: 3 })} helper="Existencias agregadas" /></section><PageSection title="Catálogo" description="Busca, ordena, configura columnas y guarda tus vistas."><ItemsList rows={items.map((row) => ({ ...row, quantity: quantityByItem[row.id] ?? 0, currencyCode: ctx.company.baseCurrencyCode, canManage }))} /></PageSection></PageShell>;
}
