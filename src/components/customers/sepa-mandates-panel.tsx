"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyState, InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { checkIban, formatIban } from "@/lib/bank-import/iban";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate } from "@/lib/format";

export type MandateRow = {
  id: string;
  mandateReference: string;
  signatureDate: Date | string;
  iban: string;
  mandateType: string;
  status: string;
  collectionCount: number;
  lastCollectionAt: Date | string | null;
  expiresAt: Date | string;
  /** Calculado en el servidor: 36 meses sin adeudos. */
  expired: boolean;
};

type Props = {
  canManage: boolean;
  customerId: string;
  defaultIban: string | null;
  mandates: MandateRow[];
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Mandatos SEPA del cliente: la autorización firmada para cobrarle recibos por domiciliación. */
export function SepaMandatesPanel({ canManage, customerId, defaultIban, mandates }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ mandateReference: "", signatureDate: today(), iban: defaultIban ? formatIban(defaultIban) : "", bic: "", mandateType: "RECURRENT" });
  const iban = form.iban ? checkIban(form.iban) : null;

  async function create() {
    setError(null);
    if (!iban?.valid) {
      setError(iban ? iban.reason : "Indica el IBAN en el que se cargarán los recibos.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/sepa/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ customerId, ...form, mandateReference: form.mandateReference.trim() || null, bic: form.bic.trim() || null }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el mandato."));
      const created = (await response.json()) as { mandateReference: string };
      toast.success(`Mandato ${created.mandateReference} guardado.`, { description: "Ya puedes incluir las facturas de este cliente en una remesa de cobros." });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar el mandato.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(mandate: MandateRow) {
    if (!window.confirm(`¿Revocar el mandato ${mandate.mandateReference}? No se usará en nuevas remesas; las ya generadas no cambian.`)) return;
    const response = await fetch(`/api/sepa/mandates/${mandate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getCsrfHeader() },
      body: JSON.stringify({ action: "revoke", customerId }),
    });
    if (!response.ok) {
      toast.error(await readApiError(response, "No se pudo revocar el mandato."));
      return;
    }
    toast.success("Mandato revocado.");
    router.refresh();
  }

  return (
    <div className="space-y-3 text-sm" data-testid="customer-sepa-mandates">
      <p className="text-xs text-muted-foreground">
        Para cobrarle por domiciliación bancaria necesitas su autorización firmada (mandato SEPA): una hoja con tus datos, su IBAN, la referencia del mandato y su firma. Guarda el papel o el PDF firmado: el banco puede pedírtelo si el cliente reclama. El cliente puede pedir la devolución de un recibo durante 8 semanas.
      </p>
      {mandates.length === 0 ? (
        <EmptyState title="Sin mandatos" description="Este cliente todavía no ha autorizado cobros por domiciliación." />
      ) : (
        <ul className="space-y-2">
          {mandates.map((mandate) => {
            const expired = mandate.status === "ACTIVE" && mandate.expired;
            return (
              <li className="flex flex-wrap items-start justify-between gap-2 border p-2" key={mandate.id}>
                <div className="space-y-0.5">
                  <p className="font-mono font-medium">{mandate.mandateReference}</p>
                  <p className="font-mono text-xs">{formatIban(mandate.iban)}</p>
                  <p className="text-xs text-muted-foreground">
                    Firmado el {formatDate(mandate.signatureDate)} · {mandate.mandateType === "ONE_OFF" ? "un solo cobro" : "cobros periódicos"} ·{" "}
                    {mandate.collectionCount === 0 ? "sin recibos cobrados (el próximo irá como primer adeudo)" : `${mandate.collectionCount} ${mandate.collectionCount === 1 ? "recibo cobrado" : "recibos cobrados"}, el último el ${mandate.lastCollectionAt ? formatDate(mandate.lastCollectionAt) : "—"}`}
                  </p>
                  {expired ? <p className="text-xs text-warning">Caducado: lleva 36 meses sin usarse. Pide al cliente que firme uno nuevo.</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={mandate.status === "ACTIVE" && !expired ? "success" : "neutral"}>{mandate.status === "ACTIVE" ? (expired ? "Caducado" : "Activo") : "Revocado"}</StatusBadge>
                  {canManage && mandate.status === "ACTIVE" ? <Button onClick={() => void revoke(mandate)} size="sm" type="button" variant="ghost">Revocar</Button> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canManage ? <Button data-testid="customer-sepa-mandate-new" onClick={() => { setError(null); setOpen(true); }} size="sm" type="button" variant="outline">Añadir mandato</Button> : null}
      {open ? (
        <Dialog description="Copia los datos del mandato firmado por el cliente. Si cambia de cuenta, revoca el anterior y añade uno nuevo." onClose={() => { if (!saving) setOpen(false); }} open title="Nuevo mandato SEPA">
          <div className="grid gap-3 sm:grid-cols-2">
            <AccessibleField className="sm:col-span-2" error={iban && !iban.valid ? iban.reason : undefined} id="mandate-iban" label="IBAN del cliente" required>
              <Input onChange={(event) => setForm({ ...form, iban: event.target.value.toUpperCase() })} placeholder="ES00 0000 0000 00 0000000000" value={form.iban} />
            </AccessibleField>
            <AccessibleField helperText="Día en que el cliente firmó la autorización." id="mandate-signature" label="Fecha de firma" required>
              <Input max={today()} onChange={(event) => setForm({ ...form, signatureDate: event.target.value })} type="date" value={form.signatureDate} />
            </AccessibleField>
            <AccessibleField helperText="Recurrente para cuotas o facturas periódicas." id="mandate-type" label="Tipo">
              <Select onChange={(event) => setForm({ ...form, mandateType: event.target.value })} value={form.mandateType}>
                <option value="RECURRENT">Cobros periódicos (recurrente)</option>
                <option value="ONE_OFF">Un solo cobro</option>
              </Select>
            </AccessibleField>
            <AccessibleField helperText="La que figura en el papel firmado. Si la dejas vacía la generamos." id="mandate-reference" label="Referencia del mandato">
              <Input maxLength={35} onChange={(event) => setForm({ ...form, mandateReference: event.target.value })} value={form.mandateReference} />
            </AccessibleField>
            <AccessibleField helperText="Opcional." id="mandate-bic" label="BIC">
              <Input maxLength={11} onChange={(event) => setForm({ ...form, bic: event.target.value.toUpperCase() })} value={form.bic} />
            </AccessibleField>
          </div>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <DialogFooter>
            <Button disabled={saving} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={saving} onClick={() => void create()} type="button">{saving ? "Guardando…" : "Guardar mandato"}</Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
