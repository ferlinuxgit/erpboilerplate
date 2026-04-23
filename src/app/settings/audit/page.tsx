import { and, desc, eq } from "drizzle-orm";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auditLog } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

export default async function AuditPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const logs = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, ctx.tenant.id), eq(auditLog.companyId, ctx.company.id))).orderBy(desc(auditLog.createdAt)).limit(100);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Auditoría</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {logs.map((log) => (
            <p key={log.id}>
              {log.createdAt.toISOString()} - {log.action} - {log.entityName}:{log.entityId}
            </p>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
