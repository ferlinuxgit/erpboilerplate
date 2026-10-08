import type { Metadata } from "next";
import Link from "next/link";

import { MastersPanel } from "@/components/settings/masters-panel";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { buttonVariants } from "@/components/ui/button";
import { PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";

export const metadata: Metadata = { title: "Inventario" };

export default async function InventorySettingsPage() {
  await requireContext("stock.write");
  return (
    <PageShell>
      <SettingsPageHeader
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/inventory/warehouses">Almacenes</Link>}
        sectionId="inventory"
      />
      <PageSection className="scroll-mt-24" id="categorias" title="Categorías de artículos" description="Agrupa tu catálogo de productos y servicios.">
        <MastersPanel blocks={["category"]} />
      </PageSection>
      <PageSection className="scroll-mt-24" id="unidades" title="Unidades de medida" description="Unidades, horas, kilos, metros… que usas en artículos y líneas.">
        <MastersPanel blocks={["unit"]} />
      </PageSection>
    </PageShell>
  );
}
