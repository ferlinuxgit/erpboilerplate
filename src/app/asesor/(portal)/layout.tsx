import type { Metadata } from "next";
import { Suspense } from "react";

import { AdvisorNav, type AdvisorNavItem } from "@/components/advisor/advisor-nav";
import { AdvisorSessionControls } from "@/components/advisor/advisor-session-controls";
import { requireAdvisorPage } from "@/server/advisor/auth";
import { NorpieLogo } from "@/components/brand/norpie-logo";

export const metadata: Metadata = { title: { default: "Portal del asesor", template: "%s · Portal del asesor" }, robots: { index: false, follow: false } };

export default async function AdvisorPortalLayout({ children }: { children: React.ReactNode }) {
  const context = await requireAdvisorPage();
  const scopes = new Set(context.access.scopes);
  const items: AdvisorNavItem[] = [
    { href: "/asesor", label: "Resumen" },
    ...(scopes.has("sales") ? [{ href: "/asesor/ventas", label: "Ventas" }] : []),
    ...(scopes.has("expenses") ? [{ href: "/asesor/gastos", label: "Gastos" }] : []),
    ...(scopes.has("accounting") ? [{ href: "/asesor/contabilidad", label: "Contabilidad" }] : []),
    ...(scopes.has("taxes") ? [{ href: "/asesor/impuestos", label: "Impuestos" }] : []),
    ...(scopes.has("sales") || scopes.has("expenses") || scopes.has("banking") || scopes.has("pos") ? [{ href: "/asesor/datos", label: "Otros datos" }] : []),
  ];
  return (
    <div className="min-h-dvh bg-background pb-8">
      <header className="border-b border-window-dark-shadow bg-chrome-active text-chrome-active-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2 sm:px-4">
          <NorpieLogo />
          <div className="min-w-0">
            <p className="font-mono text-xs text-chrome-active-foreground/80">Portal del asesor</p>
            <p className="truncate font-mono text-sm font-bold" data-testid="advisor-company-name">
              {context.company.name}
              {context.company.vatNumber ? <span className="font-normal"> · {context.company.vatNumber}</span> : null}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <span className="hidden font-mono sm:inline">{context.access.name}{context.access.firm ? ` · ${context.access.firm}` : ""}</span>
            <div className="rounded-control bg-window-surface p-1 text-window-text">
              <AdvisorSessionControls activeAccessId={context.access.id} companies={context.companies} />
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-2 pt-3 sm:px-4">
        <Suspense fallback={<div className="h-9" />}>
          <AdvisorNav items={items} />
        </Suspense>
        <main className="space-y-3 rounded-b-surface rounded-tr-surface border border-window-dark-shadow bg-card p-2 shadow-raised sm:p-3" id="main-content">
          {children}
        </main>
        <p className="mt-2 text-xs text-muted-foreground">Acceso de solo consulta. Cada descarga queda registrada para la empresa.</p>
      </div>
    </div>
  );
}
