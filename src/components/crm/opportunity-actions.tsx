"use client";

import { ArrowCounterClockwise, Trash, Trophy, XCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

import { LostReasonDialog } from "./lost-reason-dialog";
import type { CrmOpportunityView, CrmStageView } from "./types";

/** Etapa, ganada/perdida, reabrir y eliminar de una oportunidad. */
export function OpportunityActions({ opportunity, stages }: { opportunity: CrmOpportunityView; stages: CrmStageView[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [askLost, setAskLost] = useState(false);
  const wonStage = stages.find((stage) => stage.kind === "WON");
  const lostStage = stages.find((stage) => stage.kind === "LOST");
  const firstOpen = stages.find((stage) => stage.kind === "OPEN");

  async function moveTo(stageId: string, lostReason?: string) {
    setPending(true);
    try {
      const response = await fetch(`/api/crm/opportunities/${opportunity.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ stageId, ...(lostReason !== undefined ? { lostReason } : {}) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar la etapa."));
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo cambiar la etapa."));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar la oportunidad «${opportunity.title}» y sus actividades?`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/crm/opportunities/${opportunity.id}`, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo eliminar."));
      toast.success("Oportunidad eliminada.");
      router.push("/crm");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo eliminar."));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="crm-opportunity-actions">
      <label className="grid gap-1 text-xs font-medium" htmlFor="opportunity-stage-select">
        Etapa
        <Select disabled={pending} id="opportunity-stage-select" onChange={(event) => {
          const target = stages.find((stage) => stage.id === event.target.value);
          if (!target || target.id === opportunity.stageId) return;
          if (target.kind === "LOST") setAskLost(true);
          else void moveTo(target.id);
        }} value={opportunity.stageId}>
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </Select>
      </label>
      {opportunity.status === "OPEN" ? (
        <>
          {wonStage ? <Button data-testid="crm-mark-won" disabled={pending} onClick={() => void moveTo(wonStage.id)} size="sm" type="button"><Trophy aria-hidden="true" /> Ganada</Button> : null}
          {lostStage ? <Button data-testid="crm-mark-lost" disabled={pending} onClick={() => setAskLost(true)} size="sm" type="button" variant="outline"><XCircle aria-hidden="true" /> Perdida</Button> : null}
        </>
      ) : firstOpen ? (
        <Button disabled={pending} onClick={() => void moveTo(firstOpen.id)} size="sm" type="button" variant="outline"><ArrowCounterClockwise aria-hidden="true" /> Reabrir</Button>
      ) : null}
      <Button aria-label="Eliminar oportunidad" disabled={pending} onClick={() => void remove()} size="sm" type="button" variant="ghost"><Trash aria-hidden="true" /> Eliminar</Button>
      <LostReasonDialog
        onCancel={() => setAskLost(false)}
        onConfirm={(reason) => {
          setAskLost(false);
          if (lostStage) void moveTo(lostStage.id, reason);
        }}
        open={askLost}
        title={opportunity.title}
      />
    </div>
  );
}
