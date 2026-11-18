import type { Metadata } from "next";

import { AccountDataPanel } from "@/components/settings/account-data-panel";
import { SettingsPageHeader } from "@/components/settings/settings-page-header";
import { PageSection, PageShell } from "@/components/ui/page";
import { TENANT_DELETION_GRACE_DAYS } from "@/lib/billing/catalog";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { tenant } from "@/db/schema";
import { eq } from "drizzle-orm";
import { tenantsOnlyOwnedBy } from "@/server/tenant/lifecycle";

export const metadata: Metadata = { title: "Cuenta y datos" };

export default async function AccountDataPage() {
  const ctx = await requireContext();
  const [[row], soleOwnerOf] = await Promise.all([
    db.select({ deletionRequestedAt: tenant.deletionRequestedAt }).from(tenant).where(eq(tenant.id, ctx.tenant.id)).limit(1),
    tenantsOnlyOwnedBy(ctx.user.id),
  ]);
  const deletionRequestedAt = row?.deletionRequestedAt ?? null;
  return (
    <PageShell>
      <SettingsPageHeader sectionId="data" />
      <div className="space-y-4">
        <PageSection id="exportar" title="Exportar todos los datos" description="Un ZIP con todas las tablas de tu espacio (JSON) y los documentos guardados: tu copia completa, para llevártela donde quieras.">
          <AccountDataPanel
            canExport={can(ctx.membership.role, "settings.manage")}
            canClose={can(ctx.membership.role, "billing.write")}
            deletionGraceDays={TENANT_DELETION_GRACE_DAYS}
            deletionRequestedAt={deletionRequestedAt?.toISOString() ?? null}
            section="export"
            soleOwnerOf={soleOwnerOf.map((entry) => entry.name)}
            tenantName={ctx.tenant.name}
          />
        </PageSection>
        <PageSection id="baja" title="Dar de baja el espacio" description={`Cierra «${ctx.tenant.name}»: la suscripción no se renueva, el espacio queda en solo lectura ${TENANT_DELETION_GRACE_DAYS} días (para descargar tus datos o arrepentirte) y después se borra todo.`}>
          <AccountDataPanel
            canExport={can(ctx.membership.role, "settings.manage")}
            canClose={can(ctx.membership.role, "billing.write")}
            deletionGraceDays={TENANT_DELETION_GRACE_DAYS}
            deletionRequestedAt={deletionRequestedAt?.toISOString() ?? null}
            section="close"
            soleOwnerOf={soleOwnerOf.map((entry) => entry.name)}
            tenantName={ctx.tenant.name}
          />
        </PageSection>
        <PageSection id="usuario" title="Borrar mi usuario" description="Elimina tu acceso y tus datos personales. Lo que hiciste en las empresas (facturas, asientos…) se conserva a nombre de «Usuario eliminado».">
          <AccountDataPanel
            canExport={can(ctx.membership.role, "settings.manage")}
            canClose={can(ctx.membership.role, "billing.write")}
            deletionGraceDays={TENANT_DELETION_GRACE_DAYS}
            deletionRequestedAt={deletionRequestedAt?.toISOString() ?? null}
            section="user"
            soleOwnerOf={soleOwnerOf.map((entry) => entry.name)}
            tenantName={ctx.tenant.name}
          />
        </PageSection>
      </div>
    </PageShell>
  );
}
