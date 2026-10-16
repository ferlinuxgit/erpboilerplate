import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActivateModuleButton } from "@/components/modules/activate-module-button";
import { ModuleIcon } from "@/components/modules/module-icon";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { getModule, isModuleId, moduleForPath } from "@/modules/registry";
import { isModuleEnabled } from "@/server/modules/service";

export const metadata: Metadata = { title: "Módulo no activado" };

/** Destino seguro de vuelta: una ruta interna del propio módulo; si no, su página principal. */
function safeReturnPath(from: string | undefined, moduleId: string, fallback: string) {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return fallback;
  return moduleForPath(from)?.id === moduleId ? from : fallback;
}

export default async function ModuleDisabledPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string | string[] }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isModuleId(id)) notFound();
  const ctx = await requireContext();
  const manifest = getModule(id);
  const from = Array.isArray(query.from) ? query.from[0] : query.from;
  const returnTo = safeReturnPath(from, id, manifest.href);
  if (await isModuleEnabled(ctx.company.id, id)) redirect(returnTo);
  const canManage = can(ctx.membership.role, "settings.manage");

  return (
    <PageShell>
      <div className="mx-auto max-w-xl space-y-4 border border-window-shadow bg-card p-5" data-testid="module-disabled">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center border border-window-shadow text-muted-foreground"><ModuleIcon className="size-6" id={id} /></span>
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Módulo no activado</p>
            <h1 className="font-mono text-lg font-bold">{manifest.name}</h1>
          </div>
        </div>
        <p className="text-sm">{manifest.description}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {manifest.features.map((feature) => <li key={feature}>{feature}</li>)}
        </ul>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <ActivateModuleButton moduleId={id} moduleName={manifest.name} returnTo={returnTo} />
            <Link className={buttonVariants({ variant: "outline" })} href="/settings/modules">Ver todos los módulos</Link>
          </div>
        ) : (
          <InlineAlert tone="neutral">{ctx.company.name} no tiene este módulo activado. Pide a un administrador que lo active en Configuración → Módulos.</InlineAlert>
        )}
      </div>
    </PageShell>
  );
}
