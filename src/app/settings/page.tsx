import { eq } from "drizzle-orm";
import type { Metadata } from "next";

import { visibleSettingsSections } from "@/components/settings/settings-catalog";
import { SettingsIndex } from "@/components/settings/settings-index";
import { PageHeader, PageShell } from "@/components/ui/page";
import { companySettings } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsHomePage() {
  const ctx = await requireContext();
  const [settings] = await db
    .select({ businessType: companySettings.businessType })
    .from(companySettings)
    .where(eq(companySettings.companyId, ctx.company.id))
    .limit(1);
  const sections = visibleSettingsSections({ role: ctx.membership.role, businessType: settings?.businessType });

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
