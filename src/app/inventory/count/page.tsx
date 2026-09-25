import type { Metadata } from "next";

import { InventoryCountSheet } from "@/components/inventory/inventory-count-sheet";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getCountSheetData } from "@/server/inventory/count-sheet";

export const metadata: Metadata = { title: "Recuento de inventario" };

export default async function InventoryCountPage() {
  const ctx = await requireContext("stock.write");
  const data = await getCountSheetData(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        title="Recuento de inventario"
        description="Cuenta lo que hay en un almacén; el sistema calcula las diferencias y registra todos los ajustes de una vez."
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Recuento" },
        ]}
      />
      <PageSection title="Hoja de recuento" description="Escribe solo lo que hayas contado. Antes de registrar verás el resumen de ajustes.">
        <InventoryCountSheet items={data.items} stock={data.stock} warehouses={data.warehouses} />
      </PageSection>
    </PageShell>
  );
}
