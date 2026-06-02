import { eq } from "drizzle-orm";

import { ApiDocumentationPanel } from "@/components/settings/api-documentation-panel";
import { ApiKeyManager } from "@/components/settings/api-key-manager";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiKey } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";

export default async function ApiKeysPage() {
  const ctx = await requireContext("apiKey.read");
  const keys = await db
    .select({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt, revokedAt: apiKey.revokedAt })
    .from(apiKey)
    .where(eq(apiKey.tenantId, ctx.tenant.id));
  const canManage = can(ctx.membership.role, "apiKey.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="API"
        description={`Documentación y credenciales técnicas del tenant ${ctx.tenant.name} para conectar otros programas.`}
        meta={<StatusBadge tone={canManage ? "success" : "warning"}>{canManage ? "Gestión habilitada" : "Solo lectura"}</StatusBadge>}
      />
      <PageSection title="Documentación de endpoints" description="Contratos disponibles para clientes, facturas y generación de PDF.">
        <ApiDocumentationPanel tokens={keys} />
      </PageSection>
      <PageSection title="Credenciales activas" description="Las claves deben tratarse como secretos y rotarse desde seguridad cuando aplique.">
        <ApiKeyManager canManage={canManage} rows={keys} />
      </PageSection>
    </PageShell>
  );
}
