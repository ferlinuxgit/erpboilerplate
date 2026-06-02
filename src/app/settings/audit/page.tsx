import { and, desc, eq } from "drizzle-orm";

import { AuditLogList } from "@/components/settings/audit-log-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auditLog } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function AuditPage() {
  const ctx = await requireContext("settings.manage");
  const logs = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, ctx.tenant.id), eq(auditLog.companyId, ctx.company.id))).orderBy(desc(auditLog.createdAt)).limit(100);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Auditoría</CardTitle></CardHeader>
        <CardContent>
          <AuditLogList rows={logs} />
        </CardContent>
      </Card>
    </main>
  );
}
