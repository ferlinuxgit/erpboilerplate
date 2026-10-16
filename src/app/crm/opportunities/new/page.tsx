import type { Metadata } from "next";

import { OpportunityForm } from "@/components/crm/opportunity-form";
import { serializeStage } from "@/components/crm/types";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { ensureStages, listCustomerOptions, listTeamOptions } from "@/server/crm/service";

export const metadata: Metadata = { title: "Nueva oportunidad" };

export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const ctx = await requireContext("crm.write");
  const [stages, customers, team, params] = await Promise.all([ensureStages(ctx.company.id), listCustomerOptions(ctx.company.id), listTeamOptions(ctx.tenant.id), searchParams]);
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "CRM", href: "/crm" }, { label: "Nueva oportunidad" }]} description="Una posible venta: a quién, cuánto y cuándo esperas cerrarla." title="Nueva oportunidad" />
      <PageSection title="Datos de la oportunidad">
        <OpportunityForm
          currencySymbol={ctx.company.baseCurrencyCode === "EUR" ? "€" : ctx.company.baseCurrencyCode}
          currentUserId={ctx.user.id}
          customers={customers}
          initialCustomerId={customers.some((entry) => entry.id === params.customerId) ? params.customerId : undefined}
          stages={stages.map(serializeStage)}
          team={team}
        />
      </PageSection>
    </PageShell>
  );
}
