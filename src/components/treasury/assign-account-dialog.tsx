"use client";

import { useMemo, useState } from "react";

import type { RememberRule } from "@/components/treasury/reconciliation-api";
import type { AccountOption } from "@/components/treasury/split-allocation-dialog";
import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { findAccountForCode, suggestAccountCodeFromText } from "@/lib/account-aliases";
import { proposeRuleConcept } from "@/lib/bank-import/allocations";
import { formatMoney } from "@/lib/format";

/** Atajos habituales en un extracto de pyme/autónomo, en lenguaje llano. */
const QUICK_ACCOUNTS = [
  { code: "626", label: "Comisión bancaria" },
  { code: "642", label: "Cuota de autónomos / Seguridad Social" },
  { code: "4750", label: "Pago de IVA a Hacienda" },
  { code: "4751", label: "Pago de retenciones (IRPF)" },
  { code: "476", label: "Seguros sociales de empleados" },
  { code: "662", label: "Intereses de préstamo" },
  { code: "769", label: "Intereses cobrados" },
  { code: "551", label: "Aportación o retirada del socio" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  movement: { id: string; amount: number; description: string };
  accounts: AccountOption[];
  currencyCode: string;
  onSubmit: (input: { accountId: string; remember: RememberRule | null }) => Promise<void>;
};

/**
 * "Asignar a cuenta": para movimientos sin factura (comisiones, cuotas, impuestos…). Se
 * contabiliza Banco ↔ cuenta elegida y se anula el apunte en 555 «Pendiente de identificar».
 */
export function AssignAccountDialog({ accounts, currencyCode, movement, onClose, onSubmit, open }: Props) {
  const quick = useMemo(
    () => QUICK_ACCOUNTS.map((entry) => ({ ...entry, account: findAccountForCode(accounts, entry.code) })).filter((entry) => entry.account),
    [accounts],
  );
  const suggestedId = useMemo(() => findAccountForCode(accounts, suggestAccountCodeFromText(movement.description))?.id, [accounts, movement.description]);
  const [accountId, setAccountId] = useState(suggestedId ?? "");
  const [remember, setRemember] = useState(true);
  const [concept, setConcept] = useState(() => proposeRuleConcept(movement.description));
  const [autoApply, setAutoApply] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `assign-account-${movement.id}`;

  async function submit() {
    setError(null);
    if (!accountId) {
      setError("Elige la cuenta.");
      return;
    }
    if (remember && concept.trim().length < 3) {
      setError("Para recordarlo indica al menos 3 letras del concepto.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        accountId,
        remember: remember ? { conceptContains: concept.trim(), direction: movement.amount >= 0 ? "IN" : "OUT", accountId, autoApply } : null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo asignar el movimiento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      description={`${movement.description} · ${formatMoney(movement.amount, currencyCode)}. Úsalo para lo que no tiene factura: comisiones, cuota de autónomos, pagos de impuestos… Si el cargo tiene factura con IVA, regístrala como gasto y concílialo con ella.`}
      onClose={() => { if (!saving) onClose(); }}
      open={open}
      size="lg"
      title="Asignar a cuenta"
    >
      <div className="space-y-3">
        {quick.length ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Cuentas habituales">
            {quick.map((entry) => (
              <Button
                aria-pressed={accountId === entry.account?.id}
                key={entry.code}
                onClick={() => setAccountId(entry.account?.id ?? "")}
                size="sm"
                type="button"
                variant={accountId === entry.account?.id ? "default" : "outline"}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        ) : null}
        <AccessibleField helperText="Busca por palabras («comisión», «autónomos», «IVA») o por código." id={fieldId} label="Cuenta" required>
          <AccountPicker accounts={accounts} id={fieldId} onChange={(id) => setAccountId(id)} recentKey="bank-assign" suggestedIds={suggestedId ? [suggestedId] : undefined} value={accountId} />
        </AccessibleField>
        <label className="flex items-start gap-2 text-sm">
          <input checked={remember} className="mt-1" onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
          <span>
            <strong>Recordar para la próxima vez</strong>
            <span className="block text-xs text-muted-foreground">Crea una regla: cuando el concepto contenga el texto de abajo, te propondremos esta cuenta.</span>
          </span>
        </label>
        {remember ? (
          <div className="grid gap-2 pl-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <AccessibleField id={`${fieldId}-concept`} label="El concepto contiene">
              <Input onChange={(event) => setConcept(event.target.value)} value={concept} />
            </AccessibleField>
            <label className="flex items-center gap-2 text-sm">
              <input checked={autoApply} onChange={(event) => setAutoApply(event.target.checked)} type="checkbox" />
              Aplicarla sola al importar
            </label>
          </div>
        ) : null}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </div>
      <DialogFooter>
        <Button disabled={saving} onClick={onClose} type="button" variant="outline">Cancelar</Button>
        <Button disabled={saving || !accountId} onClick={() => void submit()} type="button">{saving ? "Asignando…" : "Asignar"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
