import type { Metadata } from "next";

import { RecipesManager } from "@/components/hospitality/recipes-manager";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { isModuleEnabled } from "@/server/modules/service";
import { listRecipes } from "@/server/pos/recipes";

export const metadata: Metadata = { title: "TPV · Escandallos" };

/** Escandallos: ingredientes por ración, coste, margen y food cost de cada plato. */
export default async function RecipesPage() {
  const ctx = await requireContext("pos.read");
  const [data, inventoryEnabled] = await Promise.all([listRecipes(ctx.company.id), isModuleEnabled(ctx.company.id, "inventory")]);
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "TPV", href: "/pos?choose=1" }, { label: "Escandallos" }]} description="Qué lleva cada plato y cuánto cuesta. Al venderlo, salen del almacén sus ingredientes en lugar del plato." title="Escandallos" />
      <PageSection title="Platos y costes">
        <RecipesManager canManage={can(ctx.membership.role, "pos.manage")} data={data} inventoryEnabled={inventoryEnabled} />
      </PageSection>
    </PageShell>
  );
}
