import type { Metadata } from "next";

import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";

export const metadata: Metadata = { title: "Nuevo almacén" };

export default async function NewWarehousePage() {
  await requireContext("stock.write");

  return (
    <PageShell>
      <PageHeader
        title="Nuevo almacén"
        description="Crea una ubicación para registrar entradas, salidas y transferencias."
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Almacenes", href: "/inventory/warehouses" },
          { label: "Nuevo almacén" },
        ]}
      />
      <PageSection title="Datos del almacén" description="Utiliza un código corto y reconocible en documentos y filtros.">
        <WarehouseForm />
      </PageSection>
    </PageShell>
  );
}
