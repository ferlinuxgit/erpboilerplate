import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { crmStatusLabels } from "@/modules/crm/model";

import { ActivityList } from "./activity-list";
import type { CrmActivityView, CrmOpportunityView } from "./types";

const statusTone = { OPEN: "info", WON: "success", LOST: "neutral" } as const;

/** Ficha del cliente con el CRM activo: sus oportunidades y lo pendiente con él. */
export function CustomerCrmPanel({ activities, canWrite, currencyCode, customerId, opportunities }: { activities: CrmActivityView[]; canWrite: boolean; currencyCode: string; customerId: string; opportunities: CrmOpportunityView[] }) {
  return (
    <PageSection
      actions={canWrite ? <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/crm/opportunities/new?customerId=${customerId}`}>Nueva oportunidad</Link> : undefined}
      description="Oportunidades de venta y seguimiento pendiente con este cliente."
      title="CRM"
    >
      <div className="space-y-3" data-testid="customer-crm-panel">
        {opportunities.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin oportunidades.</p>
        ) : (
          <ul className="space-y-1">
            {opportunities.map((opportunity) => (
              <li className="flex items-center justify-between gap-2 border border-window-shadow p-2 text-sm" key={opportunity.id}>
                <Link className="font-medium text-link hover:underline" href={`/crm/opportunities/${opportunity.id}`}>{opportunity.title}</Link>
                <span className="flex items-center gap-2"><span className="font-mono text-xs">{formatMoney(opportunity.amount, currencyCode)}</span><StatusBadge tone={statusTone[opportunity.status]}>{crmStatusLabels[opportunity.status]}</StatusBadge></span>
              </li>
            ))}
          </ul>
        )}
        <ActivityList activities={activities} canWrite={canWrite} emptyText="Nada pendiente con este cliente." showContext />
      </div>
    </PageSection>
  );
}
