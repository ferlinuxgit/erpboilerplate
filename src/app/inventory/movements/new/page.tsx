import { InventoryOperationsPanel } from "@/components/inventory/inventory-operations-panel";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getInventoryOptions } from "@/server/inventory/service";

export default async function NewInventoryMovementPage({ searchParams }: { searchParams: Promise<{ itemId?: string | string[]; warehouseId?: string | string[] }> }) {
  const ctx = await requireContext("stock.write");
  const options = await getInventoryOptions(ctx.company.id);
  const query = await searchParams;
  const itemId = Array.isArray(query.itemId) ? query.itemId[0] : query.itemId;
  const warehouseId = Array.isArray(query.warehouseId) ? query.warehouseId[0] : query.warehouseId;

  return (
    <PageShell>
      <PageHeader eyebrow="Inventario" title="Nuevo movimiento" description="Registra una recepción, un ajuste de conteo o una transferencia entre almacenes." backHref="/inventory" backLabel="Volver a inventario" />
      <PageSection title="Datos del movimiento" description="Selecciona el producto y la ubicación; el histórico se actualizará al guardar.">
        <InventoryOperationsPanel
          alerts={[]}
          items={options.items}
          initialMovementItemId={itemId}
          initialMovementWarehouseId={warehouseId}
          movements={[]}
          redirectAfterSubmit="/inventory"
          showOverview={false}
          stock={[]}
          warehouses={options.warehouses}
        />
      </PageSection>
    </PageShell>
  );
}
