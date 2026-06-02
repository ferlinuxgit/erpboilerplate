import Link from "next/link";

import { BillingActions } from "@/components/billing/billing-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/current-context";
import { getBillingViewModelForTenant } from "@/server/billing/data";

export default async function BillingPage() {
  const ctx = await requireContext("billing.read");
  const billing = await getBillingViewModelForTenant(ctx.tenant.id);

  return (
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Operación SaaS</CardTitle>
          <CardDescription>Planes, límites y suscripción del tenant.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-muted-foreground">Plan</dt>
              <dd className="text-base font-semibold">
                {billing.plan.name} <span className="text-muted-foreground">({billing.plan.code})</span>
              </dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Estado</dt>
              <dd className="text-base font-semibold">{billing.subscription.statusLabel}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Renovación / cancelación</dt>
              <dd>{billing.subscription.renewalLabel}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Límites</dt>
              <dd>{billing.plan.limits}</dd>
            </div>
          </dl>

          <BillingActions checkout={billing.checkout} portal={billing.portal} />

          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard">
            Volver
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
