import { eq } from "drizzle-orm";

import { ApiKeyManager } from "@/components/settings/api-key-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiKey } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";

export default async function ApiKeysPage() {
  const ctx = await requireContext("apiKey.read");
  const keys = await db.select({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt }).from(apiKey).where(eq(apiKey.tenantId, ctx.tenant.id));
  const canManage = can(ctx.membership.role, "apiKey.write");
  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>API Keys</CardTitle></CardHeader>
        <CardContent>
          <ApiKeyManager canManage={canManage} rows={keys} />
        </CardContent>
      </Card>
    </main>
  );
}
