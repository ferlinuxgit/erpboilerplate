import { eq } from "drizzle-orm";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiKey } from "@/db/schema";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

export default async function ApiKeysPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  const keys = await db.select({ id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt }).from(apiKey).where(eq(apiKey.tenantId, ctx.tenant.id));
  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>API Keys</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {keys.map((key) => <p key={key.id}>{key.name} - {key.createdAt.toISOString().slice(0, 10)}</p>)}
        </CardContent>
      </Card>
    </main>
  );
}
