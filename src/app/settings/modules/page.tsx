import type { Metadata } from "next";

import { ModulesManager } from "@/components/modules/modules-manager";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { InlineAlert, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listModuleStates } from "@/server/modules/service";

export const metadata: Metadata = { title: "Módulos" };

export default async function ModulesSettingsPage() {
  const ctx = await requireContext();
  const states = await listModuleStates(ctx.company.id);
  const canManage = can(ctx.membership.role, "settings.manage");

  return (
    <PageShell>
      <SettingsPageHeader sectionId="modules" />
      <div className="space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Facturas, gastos, contabilidad e impuestos están siempre. El resto son módulos: activa solo lo que usa {ctx.company.name} y el
          menú queda más limpio. Desactivar un módulo no borra nada: al volver a activarlo todo sigue ahí.
        </p>
        {!canManage ? <InlineAlert tone="neutral">Solo un administrador puede activar o desactivar módulos.</InlineAlert> : null}
        <ModulesManager canManage={canManage} initialStates={states} />
      </div>
    </PageShell>
  );
}
