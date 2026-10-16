"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const COMMON_REASONS = ["Precio", "Eligió a la competencia", "No hay presupuesto", "Sin respuesta", "Lo pospone"];

/** Motivo (opcional) al dar una oportunidad por perdida: ayuda a ver por qué se pierden ventas. */
export function LostReasonDialog({ onCancel, onConfirm, open, title }: { onCancel: () => void; onConfirm: (reason: string) => void; open: boolean; title: string }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog description="Opcional, pero ayuda a entender por qué se pierden ventas." initialFocusId="lost-reason" onClose={onCancel} open={open} title={`Perdida: ${title}`}>
      <div className="space-y-3">
        <AccessibleField id="lost-reason" label="Motivo">
          <Input list="lost-reason-options" maxLength={500} onChange={(event) => setReason(event.target.value)} value={reason} />
        </AccessibleField>
        <datalist id="lost-reason-options">
          {COMMON_REASONS.map((entry) => <option key={entry} value={entry} />)}
        </datalist>
        <div className="flex flex-wrap gap-1">
          {COMMON_REASONS.map((entry) => (
            <Button key={entry} onClick={() => setReason(entry)} size="sm" type="button" variant="outline">{entry}</Button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">Cancelar</Button>
        <Button data-testid="lost-confirm" onClick={() => { onConfirm(reason); setReason(""); }} type="button">Dar por perdida</Button>
      </DialogFooter>
    </Dialog>
  );
}
