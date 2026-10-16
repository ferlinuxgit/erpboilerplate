"use client";

import { CalendarBlank, Trophy, User, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { LostReasonDialog } from "./lost-reason-dialog";
import type { CrmOpportunityView, CrmStageView } from "./types";

type PendingLost = { opportunityId: string; stageId: string; index: number };

/**
 * Embudo de ventas: una columna por etapa. Las tarjetas se arrastran entre columnas; con teclado o
 * en el móvil, cada tarjeta tiene «Mover a…». Ganada/perdida cierran la oportunidad.
 */
export function PipelineBoard({ canWrite, currencyCode, initialOpportunities, stages }: { canWrite: boolean; currencyCode: string; initialOpportunities: CrmOpportunityView[]; stages: CrmStageView[] }) {
  const router = useRouter();
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<PendingLost | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const columns = useMemo(() => stages.map((stage) => {
    const cards = opportunities.filter((opportunity) => opportunity.stageId === stage.id);
    const amount = cards.reduce((sum, card) => sum + Math.round(card.amount * 100), 0) / 100;
    return { stage, cards, amount };
  }), [opportunities, stages]);

  async function move(opportunityId: string, stageId: string, index: number, lostReason?: string) {
    const stage = stages.find((entry) => entry.id === stageId);
    const previous = opportunities;
    const moving = previous.find((entry) => entry.id === opportunityId);
    if (!stage || !moving) return;
    // Optimista: la tarjeta cambia de columna al instante; si el servidor falla, vuelve.
    const rest = previous.filter((entry) => entry.id !== opportunityId);
    const target = rest.filter((entry) => entry.stageId === stageId);
    const anchor = target[index];
    const updated = { ...moving, stageId, status: stage.kind, lostReason: stage.kind === "LOST" ? lostReason ?? null : null };
    const insertAt = anchor ? rest.indexOf(anchor) : rest.length;
    setOpportunities([...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)]);
    try {
      const response = await fetch(`/api/crm/opportunities/${opportunityId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ stageId, index, ...(stage.kind === "LOST" ? { lostReason: lostReason ?? null } : {}) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo mover la oportunidad."));
      if (stage.kind === "WON") toast.success(`¡Ganada! «${moving.title}»`);
      router.refresh();
    } catch (error) {
      setOpportunities(previous);
      toast.error(errorMessage(error, "No se pudo mover la oportunidad."));
    }
  }

  function requestMove(opportunityId: string, stageId: string, index: number) {
    const stage = stages.find((entry) => entry.id === stageId);
    const current = opportunities.find((entry) => entry.id === opportunityId);
    if (!stage || !current) return;
    if (stage.kind === "LOST" && current.stageId !== stageId) {
      setPendingLost({ opportunityId, stageId, index });
      return;
    }
    void move(opportunityId, stageId, index);
  }

  function dropIndex(event: React.DragEvent, stageId: string) {
    // Posición según la tarjeta sobre la que se suelta (mitad superior = antes).
    const cardElement = (event.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
    const cards = opportunities.filter((entry) => entry.stageId === stageId && entry.id !== dragId);
    if (!cardElement) return cards.length;
    const index = cards.findIndex((entry) => entry.id === cardElement.dataset.cardId);
    if (index < 0) return cards.length;
    const rect = cardElement.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? index + 1 : index;
  }

  const pendingTitle = pendingLost ? opportunities.find((entry) => entry.id === pendingLost.opportunityId)?.title ?? "" : "";

  return (
    <>
      <div className="-mx-2 overflow-x-auto px-2 pb-2" data-testid="crm-pipeline">
        <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3">
          {columns.map(({ stage, cards, amount }) => (
            <section
              aria-label={`${stage.name}: ${cards.length} oportunidades`}
              className={cn(
                "flex min-h-48 flex-col border bg-window-panel",
                stage.kind === "WON" ? "border-success/60" : stage.kind === "LOST" ? "border-window-dark-shadow opacity-90" : "border-window-shadow",
                overStage === stage.id && "ring-2 ring-focus",
              )}
              data-testid={`crm-stage-${stage.position}`}
              key={stage.id}
              onDragLeave={() => setOverStage((current) => (current === stage.id ? null : current))}
              onDragOver={(event) => {
                if (!canWrite || !dragId) return;
                event.preventDefault();
                setOverStage(stage.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOverStage(null);
                if (dragId) requestMove(dragId, stage.id, dropIndex(event, stage.id));
                setDragId(null);
              }}
            >
              <header className="border-b border-window-shadow px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-1 font-mono text-xs font-bold uppercase">
                    {stage.kind === "WON" ? <Trophy aria-hidden="true" className="size-3.5 text-success" /> : stage.kind === "LOST" ? <XCircle aria-hidden="true" className="size-3.5" /> : null}
                    {stage.name}
                  </h2>
                  <span className="font-mono text-[11px] text-muted-foreground">{stage.kind === "OPEN" ? `${stage.probability} %` : ""}</span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {cards.length} · <span className="font-bold text-foreground">{formatMoney(amount, currencyCode)}</span>
                </p>
              </header>
              <ol className="flex flex-1 flex-col gap-2 p-2">
                {cards.length === 0 ? (
                  <li className="border border-dashed border-window-dark-shadow p-3 text-center text-[11px] text-muted-foreground">{canWrite ? "Arrastra aquí" : "Vacía"}</li>
                ) : null}
                {cards.map((card) => {
                  const overdue = card.status === "OPEN" && card.expectedCloseDate && card.expectedCloseDate.slice(0, 10) < today;
                  return (
                    <li
                      className={cn("group border border-window-dark-shadow bg-card p-2 text-xs shadow-raised", canWrite && "cursor-grab active:cursor-grabbing", dragId === card.id && "opacity-50")}
                      data-card-id={card.id}
                      data-testid={`crm-card-${card.id}`}
                      draggable={canWrite}
                      key={card.id}
                      onDragEnd={() => setDragId(null)}
                      onDragStart={(event) => {
                        setDragId(card.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", card.id);
                      }}
                    >
                      <Link className="block font-semibold text-link hover:underline" href={`/crm/opportunities/${card.id}`}>{card.title}</Link>
                      <p className="mt-0.5 truncate text-muted-foreground">{card.customerName ?? card.contactName ?? "Sin contacto"}</p>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
                        <span className="font-mono font-bold tabular-nums">{formatMoney(card.amount, currencyCode)}</span>
                        {card.expectedCloseDate ? (
                          <span className={cn("inline-flex items-center gap-0.5 font-mono text-[11px]", overdue ? "font-bold text-destructive" : "text-muted-foreground")} title={overdue ? "Cierre previsto ya pasado" : "Cierre previsto"}>
                            <CalendarBlank aria-hidden="true" className="size-3" />{formatDate(card.expectedCloseDate)}
                          </span>
                        ) : null}
                      </div>
                      {card.ownerName ? <p className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"><User aria-hidden="true" className="size-3" />{card.ownerName}</p> : null}
                      {card.status === "LOST" && card.lostReason ? <p className="mt-1 text-[11px] italic text-muted-foreground">{card.lostReason}</p> : null}
                      {canWrite ? (
                        <label className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="sr-only">Mover «{card.title}» a</span>
                          <select
                            aria-label={`Mover «${card.title}» a otra etapa`}
                            className="w-full border border-window-dark-shadow bg-window-panel px-1 py-0.5 font-mono text-[11px]"
                            data-testid={`crm-card-move-${card.id}`}
                            onChange={(event) => {
                              const target = event.target.value;
                              if (target && target !== card.stageId) requestMove(card.id, target, opportunities.filter((entry) => entry.stageId === target).length);
                            }}
                            value={card.stageId}
                          >
                            {stages.map((option) => <option key={option.id} value={option.id}>{option.id === card.stageId ? `En: ${option.name}` : `Mover a: ${option.name}`}</option>)}
                          </select>
                        </label>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </div>
      <LostReasonDialog
        onCancel={() => setPendingLost(null)}
        onConfirm={(reason) => {
          if (pendingLost) void move(pendingLost.opportunityId, pendingLost.stageId, pendingLost.index, reason);
          setPendingLost(null);
        }}
        open={pendingLost !== null}
        title={pendingTitle}
      />
    </>
  );
}
