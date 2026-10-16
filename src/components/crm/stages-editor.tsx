"use client";

import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { crmStatusLabels, validateStages, type CrmStageKind } from "@/modules/crm/model";

import type { CrmStageView } from "./types";

type DraftStage = { key: string; id?: string; name: string; probability: string; kind: CrmStageKind };

/** Etapas del embudo en orden: nombre, probabilidad de cierre y tipo (abierta, ganada o perdida). */
export function StagesEditor({ canManage, initialStages }: { canManage: boolean; initialStages: CrmStageView[] }) {
  const router = useRouter();
  const [stages, setStages] = useState<DraftStage[]>(initialStages.map((stage) => ({ key: stage.id, id: stage.id, name: stage.name, probability: String(stage.probability), kind: stage.kind })));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const patch = (key: string, values: Partial<DraftStage>) => setStages((current) => current.map((stage) => (stage.key === key ? { ...stage, ...values } : stage)));
  const move = (index: number, delta: number) => setStages((current) => {
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    return next;
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const payload = stages.map((stage) => ({ ...(stage.id ? { id: stage.id } : {}), name: stage.name.trim(), probability: Number.parseInt(stage.probability, 10), kind: stage.kind }));
    const problem = validateStages(payload);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/crm/stages", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ stages: payload }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron guardar las etapas."));
      const saved = await response.json() as CrmStageView[];
      setStages(saved.map((stage) => ({ key: stage.id, id: stage.id, name: stage.name, probability: String(stage.probability), kind: stage.kind })));
      toast.success("Embudo guardado.");
      router.refresh();
    } catch (reason) {
      setError(errorMessage(reason, "No se pudieron guardar las etapas."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-3" data-testid="crm-stages-editor" noValidate onSubmit={save}>
      <ol className="space-y-2">
        {stages.map((stage, index) => (
          <li className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-2 border border-window-shadow bg-card p-2 sm:grid-cols-[auto_minmax(0,1fr)_7rem_9rem_auto]" key={stage.key}>
            <div className="flex flex-col">
              <Button aria-label={`Subir «${stage.name}»`} disabled={!canManage || index === 0} onClick={() => move(index, -1)} size="icon-sm" type="button" variant="ghost"><ArrowUp aria-hidden="true" /></Button>
              <Button aria-label={`Bajar «${stage.name}»`} disabled={!canManage || index === stages.length - 1} onClick={() => move(index, 1)} size="icon-sm" type="button" variant="ghost"><ArrowDown aria-hidden="true" /></Button>
            </div>
            <label className="grid gap-1 text-xs font-medium">Etapa {index + 1}<Input disabled={!canManage} maxLength={60} onChange={(event) => patch(stage.key, { name: event.target.value })} value={stage.name} /></label>
            <label className="grid gap-1 text-xs font-medium">Probabilidad %<Input disabled={!canManage || stage.kind !== "OPEN"} inputMode="numeric" onChange={(event) => patch(stage.key, { probability: event.target.value.replace(/\D/g, "").slice(0, 3) })} value={stage.kind === "WON" ? "100" : stage.kind === "LOST" ? "0" : stage.probability} /></label>
            <label className="grid gap-1 text-xs font-medium">Tipo
              <Select disabled={!canManage} onChange={(event) => {
                const kind = event.target.value as CrmStageKind;
                patch(stage.key, { kind, probability: kind === "WON" ? "100" : kind === "LOST" ? "0" : stage.probability });
              }} value={stage.kind}>
                {(["OPEN", "WON", "LOST"] as const).map((kind) => <option key={kind} value={kind}>{crmStatusLabels[kind]}</option>)}
              </Select>
            </label>
            <Button aria-label={`Quitar «${stage.name}»`} disabled={!canManage || stages.length <= 3} onClick={() => setStages((current) => current.filter((entry) => entry.key !== stage.key))} size="icon-sm" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
          </li>
        ))}
      </ol>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setStages((current) => {
            const insertAt = Math.max(0, current.findIndex((stage) => stage.kind !== "OPEN"));
            const next = [...current];
            next.splice(insertAt === -1 ? current.length : insertAt, 0, { key: crypto.randomUUID(), name: "", probability: "50", kind: "OPEN" });
            return next;
          })} size="sm" type="button" variant="outline"><Plus aria-hidden="true" /> Añadir etapa</Button>
          <SubmitButton data-testid="crm-stages-save" pending={pending} size="sm">Guardar embudo</SubmitButton>
        </div>
      ) : null}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
    </form>
  );
}
