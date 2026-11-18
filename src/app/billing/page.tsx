import type { Metadata } from "next";

import { BillingDashboard } from "@/components/billing/billing-dashboard";
import { PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { getBillingOverview } from "@/server/billing/overview";

export const metadata: Metadata = { title: "Plan y facturación" };

export default async function BillingPage() {
  const ctx = await requireContext("billing.read");
  const overview = await getBillingOverview(ctx.tenant.id, ctx.company.id);
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Configuración", href: "/settings" }, { label: "Plan y facturación" }]}
        title="Plan y facturación"
        description="El plan base de contabilidad y facturación, los módulos que quieras añadir y tus créditos de lectura de facturas con IA."
      />
      <BillingDashboard canManage={can(ctx.membership.role, "billing.write")} overview={overview} />
    </PageShell>
  );
}
