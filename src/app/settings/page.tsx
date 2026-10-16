import type { Metadata } from "next";

import { visibleSettingsSections } from "@/components/settings/settings-catalog";
import { SettingsIndex } from "@/components/settings/settings-index";
import { PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { getEnabledModules } from "@/server/modules/service";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsHomePage() {
  const ctx = await requireContext();
  const modules = await getEnabledModules(ctx.company.id);
  const sections = visibleSettingsSections({ role: ctx.membership.role, modules });

  return (
    <PageShell>
      <PageHeader
        title="Configuración"
        description={`Todos los ajustes de ${ctx.company.name} en un solo sitio. Escribe lo que buscas o elige una sección.`}
      />
      <SettingsIndex sections={sections} />
    </PageShell>
  );
}
