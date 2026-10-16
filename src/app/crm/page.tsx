import type { Metadata } from "next";
import Link from "next/link";

import { PipelineBoard } from "@/components/crm/pipeline-board";
import { serializeOpportunity, serializeStage } from "@/components/crm/types";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { countOverdueActivities, getPipeline } from "@/server/crm/service";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPipelinePage({ searchParams }: { searchParams: Promise<{ mine?: string; q?: string }> }) {
  const ctx = await requireContext("crm.read");
  const params = await searchParams;
  const mine = params.mine === "1";
  const [pipeline, overdue] = await Promise.all([
    getPipeline(ctx.company.id, { ownerUserId: mine ? ctx.user.id : undefined, q: params.q }),
    countOverdueActivities(ctx.company.id, ctx.user.id),
  ]);
  const canWrite = can(ctx.membership.role, "crm.write");
  const currency = ctx.company.baseCurrencyCode;
  const { summary } = pipeline;

  return (
    <PageShell>
      <PageHeader
        title="Embudo de ventas"
        description="Cada oportunidad en su etapa. Arrastra las tarjetas para avanzarlas o usa «Mover a…»."
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href={mine ? "/crm" : "/crm?mine=1"}>{mine ? "Ver todas" : "Solo las mías"}</Link>
            {canWrite ? <Link className={buttonVariants()} data-testid="crm-new-opportunity" href="/crm/opportunities/new">Nueva oportunidad</Link> : null}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="crm-summary">
        <MetricCard helper="Oportunidades abiertas y su importe estimado." label={`Abiertas (${summary.openCount})`} value={formatMoney(summary.openAmount, currency)} />
        <MetricCard helper="Importe × probabilidad de su etapa: lo que razonablemente entrará." label="Previsión ponderada" value={formatMoney(summary.weightedAmount, currency)} />
        <MetricCard helper="Ganadas desde el día 1 de este mes." label={`Ganadas este mes (${summary.wonCount})`} tone={summary.wonCount > 0 ? "success" : "neutral"} value={formatMoney(summary.wonAmount, currency)} />
        <MetricCard
          helper={overdue > 0 ? "Tienes tareas vencidas: revisa la agenda." : "De las cerradas este mes, cuántas se ganaron."}
          href={overdue > 0 ? "/crm/activities" : undefined}
          label={overdue > 0 ? "Tareas vencidas" : "Ratio de cierre"}
          tone={overdue > 0 ? "warning" : "neutral"}
          value={overdue > 0 ? String(overdue) : summary.winRate === null ? "—" : `${summary.winRate} %`}
        />
      </div>
      <PipelineBoard
        canWrite={canWrite}
        currencyCode={currency}
        initialOpportunities={pipeline.opportunities.map(serializeOpportunity)}
        key={`${mine}-${params.q ?? ""}-${pipeline.opportunities.length}-${pipeline.opportunities.map((entry) => `${entry.id}:${entry.stageId}`).join(",")}`}
        stages={pipeline.stages.map(serializeStage)}
      />
    </PageShell>
  );
}
