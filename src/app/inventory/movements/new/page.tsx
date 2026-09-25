import type { Metadata } from "next";

import { InventoryOperationsPanel } from "@/components/inventory/inventory-operations-panel";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getInventoryOptions, getStockSnapshot } from "@/server/inventory/service";

export const metadata: Metadata = { title: "Nuevo movimiento" };

export default async function NewInventoryMovementPage({ searchParams }: { searchParams: Promise<{ itemId?: string | string[]; warehouseId?: string | string[] }> }) {
  const ctx = await requireContext("stock.write");
  const [options, stockRows] = await Promise.all([getInventoryOptions(ctx.company.id), getStockSnapshot(ctx.company.id)]);
  const query = await searchParams;
  const itemId = Array.isArray(query.itemId) ? query.itemId[0] : query.itemId;
  const warehouseId = Array.isArray(query.warehouseId) ? query.warehouseId[0] : query.warehouseId;

  return (
    <PageShell>
      <PageHeader
        title="Nuevo movimiento"
        description="Registra una entrada, una salida, un ajuste o una transferencia entre almacenes. Para contar un almacén completo usa «Recuento»."
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Movimientos", href: "/inventory/movements" },
          { label: "Nuevo movimiento" },
        ]}
      />
      <PageSection title="Datos del movimiento" description="Selecciona el producto y la ubicación; el histórico se actualizará al guardar.">
        <InventoryOperationsPanel
          alerts={[]}
          items={options.items}
          initialMovementItemId={itemId}
          initialMovementWarehouseId={warehouseId}
          movements={[]}
          redirectAfterSubmit="/inventory"
          showOverview={false}
          stock={stockRows.map((row) => ({
            itemId: row.itemId,
            itemName: row.itemName,
            itemSku: row.itemSku,
            warehouseId: row.warehouseId,
            warehouseName: row.warehouseName,
            warehouseCode: row.warehouseCode,
            minimumStock: row.minimumStock,
            quantity: row.quantity,
          }))}
          warehouses={options.warehouses}
        />
      </PageSection>
    </PageShell>
  );
}
