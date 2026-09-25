import type { Metadata } from "next";

import { BillingActions } from "@/components/billing/billing-actions";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { getBillingViewModelForTenant } from "@/server/billing/data";

export const metadata: Metadata = { title: "Suscripción" };

export default async function BillingPage() {
  const ctx = await requireContext("billing.read");
  const billing = await getBillingViewModelForTenant(ctx.tenant.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administración"
        title="Suscripción"
        description="Tu plan, sus límites y la renovación del espacio de trabajo."
        backHref="/dashboard"
        backLabel="Volver al panel"
        meta={<StatusBadge tone="info">{billing.subscription.statusLabel}</StatusBadge>}
      />
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Plan" value={billing.plan.name} helper={billing.plan.code} />
        <MetricCard label="Estado" value={billing.subscription.statusLabel} helper="Suscripción actual" />
        <MetricCard label="Renovación / cancelación" value={billing.subscription.renewalLabel} />
        <MetricCard label="Límites" value={billing.plan.limits} />
      </section>
      <PageSection
        title="Gestión de facturación"
        description="Contrata un plan o gestiona el pago y las facturas de tu suscripción."
      >
        <BillingActions checkout={billing.checkout} portal={billing.portal} />
      </PageSection>
    </PageShell>
  );
}
