import { InventoryOperationsPanel } from "@/components/inventory/inventory-operations-panel";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getInventoryOptions } from "@/server/inventory/service";

export default async function NewInventoryMovementPage() {
  const ctx = await requireContext("stock.write");
  const options = await getInventoryOptions(ctx.company.id);

  return (
    <PageShell>
      <PageHeader eyebrow="Inventario" title="Nuevo movimiento" description="Registra una recepción, un ajuste de conteo o una transferencia entre almacenes." backHref="/inventory" backLabel="Volver a inventario" />
      <PageSection title="Datos del movimiento" description="Selecciona el producto y la ubicación; el histórico se actualizará al guardar.">
        <InventoryOperationsPanel
          alerts={[]}
          items={options.items}
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
