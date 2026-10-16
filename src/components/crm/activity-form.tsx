"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { CRM_ACTIVITY_TYPES, crmActivityTypeLabels, type CrmActivityType } from "@/modules/crm/model";

import type { CrmOption } from "./types";

function localDateTimeToIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

/** Alta rápida de una actividad (en una oportunidad, un cliente o suelta en la agenda). */
export function ActivityForm({
  currentUserId,
  customerId,
  opportunityId,
  team,
  compact = false,
}: {
  currentUserId: string;
  customerId?: string | null;
  opportunityId?: string | null;
  team: CrmOption[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<CrmActivityType>("CALL");
  const [subject, setSubject] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [assignedUserId, setAssignedUserId] = useState(currentUserId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isNote = type === "NOTE";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (subject.trim().length < 2) {
      setError("Describe la actividad (p. ej. «Llamar para resolver dudas del presupuesto»).");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          type,
          subject,
          notes: notes || null,
          dueAt: isNote ? null : localDateTimeToIso(dueAt),
          opportunityId: opportunityId ?? null,
          customerId: customerId ?? null,
          assignedUserId,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la actividad."));
      setSubject("");
      setNotes("");
      setDueAt("");
      toast.success(isNote ? "Nota guardada." : "Actividad programada.");
      router.refresh();
    } catch (reason) {
      setError(errorMessage(reason, "No se pudo guardar la actividad."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-2 border border-window-shadow bg-window-panel p-2.5" data-testid="crm-activity-form" noValidate onSubmit={submit}>
      <div className={compact ? "grid gap-2" : "grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]"}>
        <AccessibleField id={`activity-type-${opportunityId ?? customerId ?? "new"}`} label="Tipo">
          <Select onChange={(event) => setType(event.target.value as CrmActivityType)} value={type}>
            {CRM_ACTIVITY_TYPES.map((entry) => <option key={entry} value={entry}>{crmActivityTypeLabels[entry]}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField id={`activity-subject-${opportunityId ?? customerId ?? "new"}`} label={isNote ? "Nota" : "Qué hay que hacer"}>
          <Input maxLength={300} onChange={(event) => setSubject(event.target.value)} placeholder={isNote ? "Qué ha pasado" : "Llamar, enviar, visitar…"} value={subject} />
        </AccessibleField>
      </div>
      {!isNote ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <AccessibleField id={`activity-due-${opportunityId ?? customerId ?? "new"}`} label="Cuándo">
            <Input onChange={(event) => setDueAt(event.target.value)} type="datetime-local" value={dueAt} />
          </AccessibleField>
          <AccessibleField id={`activity-assigned-${opportunityId ?? customerId ?? "new"}`} label="Para">
            <Select onChange={(event) => setAssignedUserId(event.target.value)} value={assignedUserId}>
              {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </Select>
          </AccessibleField>
        </div>
      ) : null}
      {!compact ? (
        <AccessibleField id={`activity-notes-${opportunityId ?? customerId ?? "new"}`} label="Detalles (opcional)">
          <Textarea maxLength={5000} onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
        </AccessibleField>
      ) : null}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <SubmitButton data-testid="crm-activity-save" pending={pending} size="sm">{isNote ? "Guardar nota" : "Programar"}</SubmitButton>
    </form>
  );
}
