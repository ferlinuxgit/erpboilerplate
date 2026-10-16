"use client";

import { CalendarCheck, ChatText, EnvelopeSimple, ListChecks, Phone, Trash, UsersThree, type Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { agendaBucket, crmActivityTypeLabels, type CrmActivityType } from "@/modules/crm/model";

import type { CrmActivityView } from "./types";

const typeIcons: Record<CrmActivityType, Icon> = { CALL: Phone, EMAIL: EnvelopeSimple, MEETING: UsersThree, TASK: ListChecks, NOTE: ChatText };

/** Actividades con su casilla de «hecha». Con `showContext` enseña a qué oportunidad o cliente pertenece. */
export function ActivityList({ activities, canWrite, emptyText = "Sin actividades.", showContext = false }: { activities: CrmActivityView[]; canWrite: boolean; emptyText?: string; showContext?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Cambio inmediato de la casilla; si el servidor falla, vuelve a su estado.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const now = new Date();

  async function setCompleted(activity: CrmActivityView, completed: boolean) {
    setBusy(activity.id);
    setOptimistic((current) => ({ ...current, [activity.id]: completed }));
    try {
      const response = await fetch(`/api/crm/activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ completed }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo actualizar la actividad."));
      router.refresh();
    } catch (error) {
      setOptimistic((current) => {
        const next = { ...current };
        delete next[activity.id];
        return next;
      });
      toast.error(errorMessage(error, "No se pudo actualizar la actividad."));
    } finally {
      setBusy(null);
    }
  }

  async function remove(activity: CrmActivityView) {
    if (!window.confirm(`¿Eliminar «${activity.subject}»?`)) return;
    setBusy(activity.id);
    try {
      const response = await fetch(`/api/crm/activities/${activity.id}`, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo eliminar la actividad."));
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo eliminar la actividad."));
    } finally {
      setBusy(null);
    }
  }

  if (activities.length === 0) return <p className="text-xs text-muted-foreground">{emptyText}</p>;

  return (
    <ul className="divide-y divide-window-shadow border border-window-shadow" data-testid="crm-activity-list">
      {activities.map((activity) => {
        const TypeIcon = typeIcons[activity.type];
        const bucket = agendaBucket(activity, now);
        const isNote = activity.type === "NOTE";
        const done = optimistic[activity.id] ?? Boolean(activity.completedAt);
        return (
          <li className={cn("flex items-start gap-2 p-2 text-xs", done && !isNote && "opacity-70")} data-testid={`crm-activity-${activity.id}`} key={activity.id}>
            {!isNote ? (
              <input
                aria-label={activity.completedAt ? `Marcar «${activity.subject}» como pendiente` : `Marcar «${activity.subject}» como hecha`}
                checked={done}
                className="mt-0.5 size-4 shrink-0"
                disabled={!canWrite || busy === activity.id}
                onChange={(event) => void setCompleted(activity, event.target.checked)}
                type="checkbox"
              />
            ) : (
              <span aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            )}
            <TypeIcon aria-label={crmActivityTypeLabels[activity.type]} className="mt-0.5 size-4 shrink-0 text-link" />
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", done && !isNote && "line-through")}>{activity.subject}</p>
              {activity.notes ? <p className="whitespace-pre-line text-muted-foreground">{activity.notes}</p> : null}
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                {activity.dueAt && !activity.completedAt ? (
                  <span className={cn(bucket === "overdue" && "font-bold text-destructive", bucket === "today" && "font-bold text-warning-text")}>
                    <CalendarCheck aria-hidden="true" className="mr-0.5 inline size-3" />{formatDateTime(activity.dueAt)}{bucket === "overdue" ? " · vencida" : ""}
                  </span>
                ) : null}
                {activity.completedAt ? <span>{isNote ? "" : "Hecha "}{formatDateTime(activity.completedAt)}</span> : null}
                {activity.assignedName && !isNote ? <span>Para {activity.assignedName}</span> : null}
                {showContext && activity.opportunityId ? <Link className="text-link underline" href={`/crm/opportunities/${activity.opportunityId}`}>{activity.opportunityTitle}</Link> : null}
                {showContext && !activity.opportunityId && activity.customerId ? <Link className="text-link underline" href={`/customers/${activity.customerId}`}>{activity.customerName}</Link> : null}
              </p>
            </div>
            {canWrite ? (
              <Button aria-label={`Eliminar «${activity.subject}»`} disabled={busy === activity.id} onClick={() => void remove(activity)} size="icon-sm" type="button" variant="ghost">
                <Trash aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
