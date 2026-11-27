"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";

type DisposeAssetDialogProps = {
  assetId: string;
  assetLabel: string;
  /** Cuentas donde se puede apuntar (contrapartida de la venta). */
  accounts: Array<{ id: string; code: string; name: string }>;
  currencyCode: string;
  defaultDate: string;
  minDate: string;
  /** Valor neto contable hoy (orientativo: al dar de baja se amortiza antes hasta la fecha). */
  netBookValueCents: number;
  resultAccounts: { loss: string; gain: string };
  /** Facturas de venta emitidas con las que se puede enlazar la venta (llevan el cliente y el IVA). */
  saleInvoices?: Array<{ id: string; label: string }>;
};

/** Baja o venta del bien: fecha, importe de la venta y cuenta de contrapartida. */
export function DisposeAssetDialog({ accounts, assetId, assetLabel, currencyCode, defaultDate, minDate, netBookValueCents, resultAccounts, saleInvoices = [] }: DisposeAssetDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"sale" | "retirement">("sale");
  const [date, setDate] = useState(defaultDate);
  const [proceeds, setProceeds] = useState("");
  const [accountId, setAccountId] = useState("");
  // Con factura: el cliente y el IVA van en ella y la baja se cuadra contra su ingreso.
  const [saleMode, setSaleMode] = useState<"invoice" | "account">(saleInvoices.length > 0 ? "invoice" : "account");
  const [salesInvoiceId, setSalesInvoiceId] = useState("");
  const withInvoice = type === "sale" && saleMode === "invoice";
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (cents: number) => formatMoney(cents / 100, currencyCode);

  async function submit() {
    if (withInvoice && !salesInvoiceId) return setError("Elige la factura de venta del bien (o cambia a «Sin factura»).");
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/fixed-assets/${assetId}/disposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          type,
          date,
          proceeds: type === "sale" ? (parseDecimalInput(proceeds, { maximumFractionDigits: 2 }) ?? 0) : 0,
          accountId: type === "sale" && !withInvoice ? accountId || null : null,
          salesInvoiceId: withInvoice ? salesInvoiceId : null,
          notes: notes || null,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo dar de baja el bien."));
      const result: { entryNumber: string; resultCents: number } = await response.json();
      const outcome = result.resultCents > 0 ? `beneficio de ${money(result.resultCents)}` : result.resultCents < 0 ? `pérdida de ${money(-result.resultCents)}` : "sin resultado";
      toast.success(`Baja contabilizada en el asiento ${result.entryNumber} (${outcome}).`);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo dar de baja el bien."));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button" variant="outline">Dar de baja o vender</Button>
      <Dialog
        description={`Se amortiza el bien hasta la fecha de baja y se genera el asiento que da de baja su valor y su amortización acumulada. La diferencia va a pérdidas (${resultAccounts.loss}) o a beneficios (${resultAccounts.gain}).`}
        initialFocusId="dispose-type"
        onClose={() => { if (!pending) setOpen(false); }}
        open={open}
        size="lg"
        title={`Baja o venta de ${assetLabel}`}
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <AccessibleField id="dispose-type" label="Operación" required>
            <Select onChange={(event) => setType(event.target.value === "retirement" ? "retirement" : "sale")} value={type}>
              <option value="sale">Venta</option>
              <option value="retirement">Baja sin cobro (rotura, robo, obsolescencia)</option>
            </Select>
          </AccessibleField>
          <AccessibleField id="dispose-date" label="Fecha de baja" required>
            <Input min={minDate} onChange={(event) => setDate(event.target.value)} required type="date" value={date} />
          </AccessibleField>
          {type === "sale" ? (
            <>
              <AccessibleField
                className="sm:col-span-2"
                helperText={saleMode === "invoice"
                  ? "Lo habitual: la venta de un bien lleva IVA y necesita factura. Emítela primero al comprador, con una línea por el precio del bien."
                  : "Solo si la venta no lleva factura (o el IVA se contabiliza aparte): el asiento no incluye IVA."}
                id="dispose-sale-mode"
                label="¿Cómo se documenta la venta?"
                required
              >
                <Select data-testid="dispose-sale-mode" onChange={(event) => setSaleMode(event.target.value === "account" ? "account" : "invoice")} value={saleMode}>
                  <option value="invoice">Con factura de venta emitida (cliente e IVA)</option>
                  <option value="account">Sin factura: contra una cuenta</option>
                </Select>
              </AccessibleField>
              {saleMode === "invoice" ? (
                <AccessibleField
                  className="sm:col-span-2"
                  helperText={saleInvoices.length === 0 ? "No hay facturas emitidas. Emite la factura de venta y vuelve a esta pantalla." : "La factura contabiliza el cobro al cliente y el IVA repercutido; esta baja, el valor del bien, su amortización y el resultado."}
                  id="dispose-invoice"
                  label="Factura de venta"
                  required
                >
                  <Select data-testid="dispose-invoice" disabled={saleInvoices.length === 0} onChange={(event) => setSalesInvoiceId(event.target.value)} value={salesInvoiceId}>
                    <option value="">Elige la factura…</option>
                    {saleInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.label}</option>)}
                  </Select>
                  <a className="mt-1 inline-block text-xs font-bold text-link underline" href="/invoices/new" rel="noopener noreferrer" target="_blank">Emitir la factura de venta (se abre en otra pestaña)</a>
                </AccessibleField>
              ) : null}
              <AccessibleField
                helperText={saleMode === "invoice" ? "Base imponible, sin IVA. Déjalo vacío para usar la base de la factura; indícalo si la factura lleva más conceptos." : "Base imponible, sin IVA."}
                id="dispose-proceeds"
                label="Importe de la venta"
                required={saleMode === "account"}
              >
                <MoneyInput onChange={(event) => setProceeds(event.target.value)} placeholder="0,00" required={saleMode === "account"} value={proceeds} />
              </AccessibleField>
              {saleMode === "account" ? (
                <AccessibleField helperText="Banco (572), deudor (440) o créditos por enajenación de inmovilizado (543 / 253)." id="dispose-account" label="Cuenta de contrapartida" required>
                  <AccountPicker accounts={accounts} id="dispose-account" onChange={(id) => setAccountId(id)} placeholder="Busca la cuenta (p. ej. banco, 543)" recentKey="fixed-asset-disposal" required value={accountId} />
                </AccessibleField>
              ) : null}
            </>
          ) : null}
          <AccessibleField className="sm:col-span-2" id="dispose-notes" label="Notas">
            <Textarea maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="Comprador, motivo de la baja…" value={notes} />
          </AccessibleField>
          <p className="font-mono text-xs text-muted-foreground sm:col-span-2">
            Valor neto contable actual: {money(netBookValueCents)} (bajará con la amortización hasta la fecha de baja). {withInvoice ? "El asiento de baja salda el ingreso que contabilizó la factura: el cobro y el IVA quedan en la factura y el resultado de la venta, en esta baja." : "Este asiento no incluye el IVA de la venta."}
          </p>
          {error ? <InlineAlert className="sm:col-span-2" role="alert" tone="danger">{error}</InlineAlert> : null}
          <DialogFooter className="sm:col-span-2">
            <Button disabled={pending} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={pending} type="submit">{pending ? "Contabilizando…" : type === "sale" ? "Contabilizar la venta" : "Contabilizar la baja"}</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
