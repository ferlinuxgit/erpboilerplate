import type { Metadata } from "next";
import Link from "next/link";

import { ActivityForm } from "@/components/crm/activity-form";
import { ActivityList } from "@/components/crm/activity-list";
import { serializeActivity } from "@/components/crm/types";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { agendaBucket, agendaBucketLabels, type AgendaBucket } from "@/modules/crm/model";
import { listActivities, listTeamOptions } from "@/server/crm/service";

export const metadata: Metadata = { title: "Agenda del CRM" };

const ORDER: AgendaBucket[] = ["overdue", "today", "upcoming", "unscheduled"];

export default async function CrmActivitiesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await requireContext("crm.read");
  const all = (await searchParams).all === "1";
  const assignedUserId = all ? undefined : ctx.user.id;
  const [pending, done, team] = await Promise.all([
    listActivities(ctx.company.id, { assignedUserId }),
    listActivities(ctx.company.id, { assignedUserId, doneOnly: true, limit: 20 }),
    listTeamOptions(ctx.tenant.id),
  ]);
  const now = new Date();
  const canWrite = can(ctx.membership.role, "crm.write");
  const grouped = new Map<AgendaBucket, ReturnType<typeof serializeActivity>[]>();
  for (const activity of pending.map(serializeActivity)) {
    const bucket = agendaBucket(activity, now, ctx.company.timezone || "Europe/Madrid");
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), activity]);
  }

  return (
    <PageShell>
      <PageHeader
        title="Agenda"
        description={all ? "Las tareas pendientes de todo el equipo." : "Tus llamadas, reuniones y tareas pendientes."}
        actions={<Link className={buttonVariants({ variant: "outline" })} href={all ? "/crm/activities" : "/crm/activities?all=1"}>{all ? "Solo las mías" : "Todo el equipo"}</Link>}
      />
      {canWrite ? (
        <PageSection title="Nueva tarea" description="Suelta, sin oportunidad (para recordatorios generales).">
          <ActivityForm compact currentUserId={ctx.user.id} team={team} />
        </PageSection>
      ) : null}
      {ORDER.map((bucket) => {
        const items = grouped.get(bucket) ?? [];
        if (items.length === 0 && bucket !== "today") return null;
        return (
          <PageSection key={bucket} title={`${agendaBucketLabels[bucket]} (${items.length})`}>
            <ActivityList activities={items} canWrite={canWrite} emptyText="Nada para hoy." showContext />
          </PageSection>
        );
      })}
      <PageSection title="Hechas recientemente">
        <ActivityList activities={done.map(serializeActivity)} canWrite={canWrite} emptyText="Aún no has completado ninguna." showContext />
      </PageSection>
    </PageShell>
  );
}
