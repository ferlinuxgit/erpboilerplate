import { and, desc, eq } from "drizzle-orm";

import { AuditLogList } from "@/components/settings/audit-log-list";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { auditLog } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function AuditPage() {
  const ctx = await requireContext("settings.manage");
  const logs = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, ctx.tenant.id), eq(auditLog.companyId, ctx.company.id))).orderBy(desc(auditLog.createdAt)).limit(100);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Auditoría"
        description={`Últimos eventos sensibles de ${ctx.company.name}; usa este registro para revisar cambios operativos y de seguridad.`}
      />
      <PageSection title="Eventos recientes" description="Mostramos los 100 eventos más recientes del tenant y empresa activa.">
        <AuditLogList rows={logs} />
      </PageSection>
    </PageShell>
  );
}
