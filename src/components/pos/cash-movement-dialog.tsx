"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { parseDecimalInput } from "@/lib/format";

/** Entrada o salida de efectivo del cajón (añadir cambio, retirar al banco…). Cuenta en el arqueo. */
export function CashMovementDialog({ bankAccounts, onClose, open, sessionId }: { bankAccounts: Array<{ id: string; name: string }>; onClose: () => void; open: boolean; sessionId: string }) {
  const router = useRouter();
  const [type, setType] = useState<"IN" | "OUT">("OUT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const value = parseDecimalInput(amount, { maximumFractionDigits: 2 });
    if (!value || value <= 0) return setError("Indica el importe.");
    if (reason.trim().length < 2) return setError("Indica el motivo.");
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/sessions/${sessionId}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ type, amount: value, reason, bankAccountId: bankAccountId || null }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el movimiento."));
      toast.success(`${type === "IN" ? "Entrada" : "Salida"} de efectivo anotada${bankAccountId ? " y contabilizada" : ""}.`);
      setAmount("");
      setReason("");
      onClose();
      router.refresh();
    } catch (reasonError) {
      setError(errorMessage(reasonError, "No se pudo guardar el movimiento."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog description="Los traspasos con el banco se contabilizan; los gastos pagados en efectivo se registran en Gastos." initialFocusId="pos-movement-amount" onClose={onClose} open={open} title="Entrada o salida de efectivo">
      <div className="grid gap-2">
        <AccessibleField id="pos-movement-type" label="Tipo">
          <Select onChange={(event) => setType(event.target.value as "IN" | "OUT")} value={type}>
            <option value="OUT">Salida (retirada, pago…)</option>
            <option value="IN">Entrada (añadir cambio…)</option>
          </Select>
        </AccessibleField>
        <AccessibleField helperText={bankAccountId ? (type === "OUT" ? "Ingreso del efectivo en el banco: asiento 572 a 570." : "Cambio retirado del banco: asiento 570 a 572.") : "Solo cuenta en el arqueo, sin asiento."} id="pos-movement-bank" label={type === "OUT" ? "¿Va al banco?" : "¿Viene del banco?"}>
          <Select onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}>
            <option value="">No (solo arqueo)</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField id="pos-movement-amount" label="Importe"><MoneyInput onChange={(event) => setAmount(event.target.value)} value={amount} /></AccessibleField>
        <AccessibleField id="pos-movement-reason" label="Motivo"><Input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Retirada al banco, cambio…" value={reason} /></AccessibleField>
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      </div>
      <DialogFooter>
        <Button onClick={onClose} type="button" variant="ghost">Cancelar</Button>
        <Button disabled={pending} onClick={() => void save()} type="button">Guardar</Button>
      </DialogFooter>
    </Dialog>
  );
}
