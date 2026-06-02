import { eq } from "drizzle-orm";

import { ApiKeyManager } from "@/components/settings/api-key-manager";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiKey } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";

export default async function ApiKeysPage() {
  const ctx = await requireContext("apiKey.read");
  const keys = await db.select({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt }).from(apiKey).where(eq(apiKey.tenantId, ctx.tenant.id));
  const canManage = can(ctx.membership.role, "apiKey.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Claves API"
        description={`Credenciales técnicas del tenant ${ctx.tenant.name}; crea, revisa y revoca accesos de integración.`}
        meta={<StatusBadge tone={canManage ? "success" : "warning"}>{canManage ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>}
      />
      <PageSection title="Credenciales activas" description="Las claves deben tratarse como secretos y rotarse desde seguridad cuando aplique.">
        <ApiKeyManager canManage={canManage} rows={keys} />
      </PageSection>
    </PageShell>
  );
}
