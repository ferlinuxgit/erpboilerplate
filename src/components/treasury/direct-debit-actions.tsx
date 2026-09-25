"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney } from "@/lib/format";

type Action = "collect" | "uncollect" | "cancel";

const copy: Record<Action, { title: string; description: string; button: string; done: string }> = {
  collect: {
    title: "Marcar remesa como cobrada",
    description: "Confirma que el banco ha abonado (o va a abonar) los recibos. Se registrará un cobro por factura con la fecha de cobro y las facturas quedarán cobradas. Si luego algún cliente devuelve su recibo, márcalo como devuelto.",
    button: "Remesa cobrada",
    done: "Cobros registrados. Cuando el abono aparezca en el extracto, concílialo con la propuesta «Remesa SEPA».",
  },
  uncollect: {
    title: "Deshacer el cobro",
    description: "Se eliminarán los cobros registrados por esta remesa y las facturas volverán a estar pendientes. Solo es posible si ninguno está conciliado con el banco ni devuelto.",
    button: "Deshacer cobro",
    done: "Cobros eliminados: la remesa vuelve a estar pendiente.",
  },
  cancel: {
    title: "Descartar remesa",
    description: "La remesa quedará descartada y sus facturas podrán incluirse en otra. No borra nada en el banco: si ya subiste el fichero, anúlalo también allí.",
    button: "Descartar remesa",
    done: "Remesa descartada.",
  },
};

export function DirectDebitActions({ id, number, status }: { id: string; number: string; status: string }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/sepa/direct-debits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo actualizar la remesa."));
      toast.success(copy[action].done);
      setAction(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar la remesa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "CANCELLED" ? (
        <a className={buttonVariants({ variant: status === "GENERATED" ? "default" : "outline" })} download={`recibos-${number}.xml`} href={`/api/sepa/direct-debits/${id}?download=xml`}>
          Descargar fichero de recibos
        </a>
      ) : null}
      {status === "GENERATED" ? (
        <>
          <Button data-testid="direct-debit-collect" onClick={() => { setError(null); setAction("collect"); }} type="button" variant="outline">{copy.collect.button}</Button>
          <Button onClick={() => { setError(null); setAction("cancel"); }} type="button" variant="ghost">{copy.cancel.button}</Button>
        </>
      ) : null}
      {status === "COLLECTED" ? <Button onClick={() => { setError(null); setAction("uncollect"); }} type="button" variant="outline">{copy.uncollect.button}</Button> : null}
      {action ? (
        <Dialog description={copy[action].description} onClose={() => { if (!busy) setAction(null); }} open title={copy[action].title}>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button disabled={busy} onClick={() => setAction(null)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={busy} onClick={() => void run()} type="button">{busy ? "Guardando…" : copy[action].button}</Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}

type Candidate = { id: string; amount: string; description: string; postedAt: string };
type FeeAccount = { id: string; code: string; name: string };

/** Motivos de devolución SEPA más habituales (código R-transaction) en lenguaje llano. */
const RETURN_REASONS = [
  { code: "AM04", label: "Fondos insuficientes" },
  { code: "MD06", label: "El cliente pidió la devolución" },
  { code: "MD01", label: "Sin mandato o mandato no válido" },
  { code: "AC04", label: "Cuenta cancelada" },
  { code: "AC01", label: "IBAN incorrecto" },
  { code: "MS02", label: "Motivo no indicado por el cliente" },
];

/**
 * Devolución de un recibo cobrado ("devolución" en el extracto): la factura vuelve a pendiente.
 * Opcionalmente se concilia el cargo del banco, llevando la comisión a gastos (626).
 */
export function DirectDebitReturnButton({ currencyCode, feeAccounts, item, mode }: { currencyCode: string; feeAccounts: FeeAccount[]; item: { id: string; endToEndId: string; amount: string; invoiceNumber: string }; mode: "return" | "link" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [form, setForm] = useState({ returnedAt: new Date().toISOString().slice(0, 10), reason: RETURN_REASONS[0].label, bankTransactionId: "", feeAccountId: feeAccounts.find((account) => account.code.startsWith("626"))?.id ?? "" });
  const chosen = candidates?.find((candidate) => candidate.id === form.bankTransactionId) ?? null;
  const fee = chosen ? Math.round((-Number(chosen.amount) - Number(item.amount)) * 100) / 100 : 0;

  async function openDialog() {
    setError(null);
    setOpen(true);
    try {
      const response = await fetch(`/api/sepa/direct-debits/items/${item.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron cargar los movimientos."));
      setCandidates((await response.json()) as Candidate[]);
    } catch (caught) {
      setCandidates([]);
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los movimientos.");
    }
  }

  async function submit() {
    if (mode === "link" && !form.bankTransactionId) {
      setError("Elige el cargo de la devolución en el extracto.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = mode === "link"
        ? { action: "link", bankTransactionId: form.bankTransactionId, feeAccountId: fee > 0 ? form.feeAccountId || null : null }
        : { action: "return", returnedAt: form.returnedAt, reason: form.reason, bankTransactionId: form.bankTransactionId || null, feeAccountId: fee > 0 ? form.feeAccountId || null : null };
      const response = await fetch(`/api/sepa/direct-debits/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar la devolución."));
      toast.success(mode === "link" ? "Cargo de la devolución conciliado." : `Recibo de ${item.invoiceNumber} devuelto: la factura vuelve a estar pendiente de cobro.`);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo registrar la devolución.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => void openDialog()} size="sm" type="button" variant="ghost">{mode === "link" ? "Vincular cargo" : "Devuelto"}</Button>
      {open ? (
        <Dialog
          description={mode === "link"
            ? "Elige el cargo del extracto con esta devolución. Lo que supere el importe del recibo se contabiliza como comisión."
            : "El banco del cliente ha devuelto este recibo. Se anulará su cobro con la fecha de la devolución y la factura volverá a estar pendiente (podrás incluirla en otra remesa o reclamarla)."}
          onClose={() => { if (!busy) setOpen(false); }}
          open
          title={mode === "link" ? `Cargo de la devolución · ${item.endToEndId}` : `Devolución del recibo ${item.endToEndId}`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {mode === "return" ? (
              <>
                <AccessibleField id={`return-date-${item.id}`} label="Fecha de la devolución" required>
                  <Input onChange={(event) => setForm({ ...form, returnedAt: event.target.value })} type="date" value={form.returnedAt} />
                </AccessibleField>
                <AccessibleField id={`return-reason-${item.id}`} label="Motivo">
                  <Select onChange={(event) => setForm({ ...form, reason: event.target.value })} value={form.reason}>
                    {RETURN_REASONS.map((reason) => <option key={reason.code} value={reason.label}>{reason.label} ({reason.code})</option>)}
                  </Select>
                </AccessibleField>
              </>
            ) : null}
            <AccessibleField className="sm:col-span-2" helperText={mode === "return" ? "Opcional: si el cargo aún no está en el extracto, podrás vincularlo después." : undefined} id={`return-movement-${item.id}`} label="Cargo en el extracto">
              <Select disabled={candidates === null} onChange={(event) => setForm({ ...form, bankTransactionId: event.target.value })} value={form.bankTransactionId}>
                <option value="">{candidates === null ? "Cargando…" : candidates.length === 0 ? "No hay cargos pendientes que encajen" : "Todavía no / no lo sé"}</option>
                {(candidates ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{formatDate(candidate.postedAt)} · {formatMoney(candidate.amount, currencyCode)} · {candidate.description.slice(0, 60)}</option>
                ))}
              </Select>
            </AccessibleField>
            {fee > 0 ? (
              <AccessibleField className="sm:col-span-2" helperText={`La comisión de devolución (${formatMoney(fee, currencyCode)}) es un gasto: normalmente 626 «Servicios bancarios».`} id={`return-fee-${item.id}`} label="Cuenta de la comisión">
                <Select onChange={(event) => setForm({ ...form, feeAccountId: event.target.value })} value={form.feeAccountId}>
                  <option value="">Automática (626)</option>
                  {feeAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
                </Select>
              </AccessibleField>
            ) : null}
          </div>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <DialogFooter>
            <Button disabled={busy} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={busy} onClick={() => void submit()} type="button">{busy ? "Guardando…" : mode === "link" ? "Vincular cargo" : "Registrar devolución"}</Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}
