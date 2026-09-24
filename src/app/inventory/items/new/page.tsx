import type { Metadata } from "next";

import { ItemForm } from "@/components/inventory/item-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";

export const metadata: Metadata = { title: "Nuevo artículo" };

export default async function NewItemPage() {
  await requireContext("stock.write");

  return (
    <PageShell>
      <PageHeader
        title="Nuevo artículo"
        description="Crea un producto con stock o un servicio facturable."
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Artículos", href: "/inventory/items" },
          { label: "Nuevo artículo" },
        ]}
      />
      <PageSection title="Datos del artículo" description="El SKU identifica el artículo en documentos, movimientos e informes.">
        <ItemForm />
      </PageSection>
    </PageShell>
  );
}
