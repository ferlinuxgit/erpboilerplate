import type { Metadata } from "next";

import { StagesEditor } from "@/components/crm/stages-editor";
import { serializeStage } from "@/components/crm/types";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { ensureStages } from "@/server/crm/service";

export const metadata: Metadata = { title: "Etapas del embudo" };

export default async function CrmSettingsPage() {
  const ctx = await requireContext("crm.read");
  const stages = await ensureStages(ctx.company.id);
  const canManage = can(ctx.membership.role, "settings.manage");
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "CRM", href: "/crm" }, { label: "Etapas" }]} description="Adapta el embudo a cómo vendes: nombre de cada etapa, su orden y la probabilidad de cerrar desde ella." title="Etapas del embudo" />
      {!canManage ? <InlineAlert tone="neutral">Solo un administrador puede cambiar las etapas.</InlineAlert> : null}
      <PageSection title="Etapas" description="Las etapas «ganada» y «perdida» cierran la oportunidad. Una etapa con oportunidades no se puede quitar.">
        <StagesEditor canManage={canManage} initialStages={stages.map(serializeStage)} />
      </PageSection>
    </PageShell>
  );
}
