import type { Metadata } from "next";

import { ItemForm } from "@/components/inventory/item-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { listItemFormOptions } from "@/server/inventory/item-options";

export const metadata: Metadata = { title: "Nuevo artículo" };

export default async function NewItemPage() {
  const ctx = await requireContext("stock.write");
  const options = await listItemFormOptions(ctx.company.id);

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
        <ItemForm options={options} />
      </PageSection>
    </PageShell>
  );
}
