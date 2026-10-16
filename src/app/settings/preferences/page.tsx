import type { Metadata } from "next";
import Link from "next/link";

import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { UserPreferencesPanel } from "@/components/settings/user-preferences-panel";
import { buttonVariants } from "@/components/ui/button";
import { PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { roleLabels, statusLabel } from "@/lib/status-labels";

export const metadata: Metadata = { title: "Mis preferencias" };

export default async function PreferencesPage() {
  const ctx = await requireContext();
  return (
    <PageShell>
      <SettingsPageHeader sectionId="preferences" />
      <PageSection className="scroll-mt-24" id="cuenta" title="Mi cuenta" description="Con qué datos entras y qué puedes hacer en esta empresa.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-mono text-xs font-bold">Nombre</dt>
            <dd>{ctx.user.name}</dd>
            <dt className="font-mono text-xs font-bold">Email</dt>
            <dd>{ctx.user.email}</dd>
            <dt className="font-mono text-xs font-bold">Rol</dt>
            <dd>{statusLabel(roleLabels, ctx.membership.role)} en {ctx.company.name}</dd>
          </dl>
          <Link className={buttonVariants({ variant: "outline" })} href="/auth/forgot-password">Cambiar mi contraseña</Link>
        </div>
      </PageSection>
      <PageSection className="scroll-mt-24" id="apariencia" title="Apariencia" description="La paleta de colores de la interfaz.">
        <UserPreferencesPanel part="appearance" />
      </PageSection>
      <PageSection className="scroll-mt-24" id="teclado" title="Teclado" description="Atajos y códigos para trabajar sin ratón.">
        <UserPreferencesPanel part="keyboard" />
      </PageSection>
    </PageShell>
  );
}
