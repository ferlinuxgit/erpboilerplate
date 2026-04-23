import Link from "next/link";
import { eq } from "drizzle-orm";

import { subscription, tenant } from "@/db/schema";
import { BillingActions } from "@/components/billing/billing-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ensureUserTenant } from "@/lib/tenant";

export default async function BillingPage() {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });

  const currentTenant = await db.select().from(tenant).where(eq(tenant.id, ctx.tenant.id)).limit(1);
  const subs = await db.select().from(subscription).where(eq(subscription.tenantId, ctx.tenant.id)).limit(1);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Operación SaaS</CardTitle>
          <CardDescription>Planes, límites y suscripción del tenant.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>Plan tenant: {currentTenant[0]?.plan ?? "free"}</p>
          <p>Estado suscripción: {subs[0]?.status ?? "sin suscripción"}</p>
          <BillingActions fallbackPriceId={process.env.NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID ?? "price_placeholder"} />
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
