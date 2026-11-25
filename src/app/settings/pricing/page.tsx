import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { CustomerGroupsPanel, PriceListsPanel } from "@/components/settings/pricing-settings";
import { PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { listCustomerGroups, listPriceLists } from "@/server/pricing/service";

export const metadata: Metadata = { title: "Tarifas y descuentos" };

export default async function PricingSettingsPage() {
  const ctx = await requireContext("settings.manage");
  const [lists, groups] = await Promise.all([listPriceLists(ctx.company.id), listCustomerGroups(ctx.company.id)]);
  return (
    <PageShell>
      <SettingsPageHeader sectionId="pricing" />
      <PageSection
        className="scroll-mt-24"
        description="Precios de venta especiales. Se aplican al elegir un artículo en presupuestos, pedidos y facturas de los clientes que la tengan (por su grupo o en su ficha)."
        id="tarifas"
        title="Tarifas de precios"
      >
        <PriceListsPanel lists={lists} />
      </PageSection>
      <PageSection
        className="scroll-mt-24"
        description="Cada grupo da a sus clientes una tarifa y un descuento de línea. El grupo se elige en la ficha del cliente."
        id="grupos"
        title="Grupos de clientes"
      >
        <CustomerGroupsPanel groups={groups} lists={lists} />
      </PageSection>
    </PageShell>
  );
}
