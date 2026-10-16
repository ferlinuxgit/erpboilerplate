import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityForm } from "@/components/crm/activity-form";
import { ActivityList } from "@/components/crm/activity-list";
import { ConvertContactDialog } from "@/components/crm/convert-contact-dialog";
import { OpportunityActions } from "@/components/crm/opportunity-actions";
import { OpportunityForm } from "@/components/crm/opportunity-form";
import { serializeActivity, serializeOpportunity, serializeStage } from "@/components/crm/types";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { crmSourceLabels, crmStatusLabels, type CrmSource } from "@/modules/crm/model";
import { getOpportunity, listCustomerOptions, listTeamOptions } from "@/server/crm/service";
import { isModuleEnabled } from "@/server/modules/service";

export const metadata: Metadata = { title: "Oportunidad" };

const statusTone = { OPEN: "info", WON: "success", LOST: "neutral" } as const;

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("crm.read");
  const detail = await getOpportunity(ctx.company.id, (await params).id);
  if (!detail) notFound();
  const [customers, team, quotesEnabled] = await Promise.all([listCustomerOptions(ctx.company.id), listTeamOptions(ctx.tenant.id), isModuleEnabled(ctx.company.id, "sales-documents")]);
  const opportunity = serializeOpportunity(detail.opportunity);
  const stages = detail.stages.map(serializeStage);
  const stage = stages.find((entry) => entry.id === opportunity.stageId);
  const canWrite = can(ctx.membership.role, "crm.write");
  const currency = ctx.company.baseCurrencyCode;
  const activities = detail.activities.map(serializeActivity);
  const pending = activities.filter((activity) => !activity.completedAt);
  const history = activities.filter((activity) => activity.completedAt);

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "CRM", href: "/crm" }, { label: "Oportunidades", href: "/crm/opportunities" }, { label: opportunity.title }]}
        description={`${opportunity.customerName ?? opportunity.contactName ?? "Sin contacto"} · ${formatMoney(opportunity.amount, currency)}${stage && opportunity.status === "OPEN" ? ` · ${stage.probability} % de probabilidad` : ""}`}
        meta={<StatusBadge tone={statusTone[opportunity.status]}>{opportunity.status === "OPEN" ? stage?.name ?? "Abierta" : crmStatusLabels[opportunity.status]}</StatusBadge>}
        title={opportunity.title}
        actions={
          quotesEnabled && opportunity.customerId && can(ctx.membership.role, "invoice.create") ? (
            <Link className={buttonVariants()} data-testid="crm-create-quote" href={`/sales/new?customerId=${opportunity.customerId}&crmOpportunityId=${opportunity.id}`}>Crear presupuesto</Link>
          ) : null
        }
      />
      {canWrite ? <OpportunityActions opportunity={opportunity} stages={stages} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-4">
          <PageSection title="Seguimiento" description="Lo que hay que hacer y lo que ya se hizo.">
            <div className="space-y-3">
              {canWrite ? <ActivityForm currentUserId={ctx.user.id} opportunityId={opportunity.id} team={team} /> : null}
              <h3 className="font-mono text-xs font-bold uppercase">Pendiente</h3>
              <ActivityList activities={pending} canWrite={canWrite} emptyText="Nada pendiente. Programa la siguiente llamada o tarea para no perderla de vista." />
              <h3 className="font-mono text-xs font-bold uppercase">Historial</h3>
              <ActivityList activities={history} canWrite={canWrite} emptyText="Aún no hay historial." />
            </div>
          </PageSection>
        </div>
        <div className="space-y-4">
          <PageSection title="Resumen">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Cliente</dt>
              <dd className="text-right">{opportunity.customerId ? <Link className="text-link underline" href={`/customers/${opportunity.customerId}`}>{opportunity.customerName}</Link> : <span>{opportunity.contactName} <span className="text-xs text-muted-foreground">(sin ficha)</span></span>}</dd>
              {opportunity.contactEmail ? <><dt className="text-muted-foreground">Email</dt><dd className="truncate text-right"><a className="text-link underline" href={`mailto:${opportunity.contactEmail}`}>{opportunity.contactEmail}</a></dd></> : null}
              {opportunity.contactPhone ? <><dt className="text-muted-foreground">Teléfono</dt><dd className="text-right"><a className="text-link underline" href={`tel:${opportunity.contactPhone}`}>{opportunity.contactPhone}</a></dd></> : null}
              <dt className="text-muted-foreground">Importe</dt><dd className="text-right font-mono font-bold">{formatMoney(opportunity.amount, currency)}</dd>
              <dt className="text-muted-foreground">Cierre previsto</dt><dd className="text-right">{opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : "—"}</dd>
              {opportunity.closedAt ? <><dt className="text-muted-foreground">Cerrada</dt><dd className="text-right">{formatDate(opportunity.closedAt)}</dd></> : null}
              {opportunity.lostReason ? <><dt className="text-muted-foreground">Motivo</dt><dd className="text-right">{opportunity.lostReason}</dd></> : null}
              <dt className="text-muted-foreground">Responsable</dt><dd className="text-right">{opportunity.ownerName ?? "—"}</dd>
              <dt className="text-muted-foreground">Origen</dt><dd className="text-right">{opportunity.source ? crmSourceLabels[opportunity.source as CrmSource] ?? opportunity.source : "—"}</dd>
              {detail.quote ? <><dt className="text-muted-foreground">Presupuesto</dt><dd className="text-right"><Link className="text-link underline" href={`/sales/quotes/${detail.quote.id}`}>{detail.quote.number}</Link> · {formatMoney(detail.quote.totalAmount, currency)}</dd></> : null}
            </dl>
            {!opportunity.customerId && opportunity.contactName && canWrite && can(ctx.membership.role, "customer.create") ? (
              <div className="mt-3"><ConvertContactDialog contact={{ name: opportunity.contactName, email: opportunity.contactEmail, phone: opportunity.contactPhone }} opportunityId={opportunity.id} /></div>
            ) : null}
          </PageSection>
          {canWrite ? (
            <PageSection title="Editar">
              <OpportunityForm currencySymbol={currency === "EUR" ? "€" : currency} currentUserId={ctx.user.id} customers={customers} initial={opportunity} stages={stages} team={team} />
            </PageSection>
          ) : opportunity.notes ? (
            <PageSection title="Notas"><p className="whitespace-pre-line text-sm">{opportunity.notes}</p></PageSection>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
