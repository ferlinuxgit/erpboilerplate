"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";

export type CreditTargetInvoice = { id: string; label: string; outstanding: number };
export type CreditBankAccount = { id: string; label: string };

/**
 * Acciones sobre el saldo a favor de un abono de proveedor: compensarlo con otra factura pendiente
 * del mismo proveedor (sin asiento) o registrar que el proveedor devolvió el dinero por banco.
 */
export function SupplierCreditActions({
  creditId,
  remaining,
  currencyCode,
  invoices,
  bankAccounts,
}: {
  creditId: string;
  remaining: number;
  currencyCode: string;
  invoices: CreditTargetInvoice[];
  bankAccounts: CreditBankAccount[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"apply" | "refund" | null>(null);
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [postedAt, setPostedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const target = invoices.find((invoice) => invoice.id === invoiceId);
  const maxAmount = mode === "apply" ? Math.min(remaining, target?.outstanding ?? 0) : remaining;

  function open(next: "apply" | "refund") {
    setFormError(null);
    const max = next === "apply" ? Math.min(remaining, invoices[0]?.outstanding ?? 0) : remaining;
    setInvoiceId(invoices[0]?.id ?? "");
    setAmount(max > 0 ? max.toFixed(2).replace(".", ",") : "");
    setMode(next);
  }

  async function submit() {
    setFormError(null);
    const parsed = parseDecimalInput(amount, { maximumFractionDigits: 2 });
    if (parsed === null || parsed <= 0) return setFormError("Indica un importe mayor que cero (por ejemplo, 120,50).");
    if (parsed > maxAmount + 0.005) return setFormError(`El importe no puede superar ${formatMoney(maxAmount, currencyCode)}.`);
    if (mode === "apply" && !invoiceId) return setFormError("Elige la factura con la que se compensa.");
    if (mode === "refund" && !bankAccountId) return setFormError("Elige la cuenta bancaria en la que entró la devolución.");
    if (mode === "refund" && !postedAt) return setFormError("Indica la fecha del cobro.");
    setPending(true);
    try {
      const response = await fetch(mode === "apply" ? "/api/supplier-credits" : "/api/supplier-credits/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify(mode === "apply"
          ? { creditInvoiceId: creditId, supplierInvoiceId: invoiceId, amount: parsed }
          : { creditInvoiceId: creditId, amount: parsed, postedAt: new Date(`${postedAt}T12:00:00.000Z`).toISOString(), bankAccountId, reference }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar."));
      toast.success(mode === "apply" ? `Abono compensado por ${formatMoney(parsed, currencyCode)}.` : `Devolución de ${formatMoney(parsed, currencyCode)} registrada.`);
      setMode(null);
      router.refresh();
    } catch (error) {
      const message = errorMessage(error, "No se pudo guardar. Inténtalo de nuevo.");
      setFormError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button data-testid="supplier-credit-apply" disabled={invoices.length === 0} onClick={() => open("apply")} title={invoices.length === 0 ? "El proveedor no tiene facturas pendientes de pago" : undefined} type="button" variant="outline">
        Compensar con una factura
      </Button>
      <Button data-testid="supplier-credit-refund" disabled={bankAccounts.length === 0} onClick={() => open("refund")} title={bankAccounts.length === 0 ? "Da de alta una cuenta bancaria en Tesorería" : undefined} type="button" variant="outline">
        Cobrar devolución
      </Button>
      <Dialog
        description={mode === "apply"
          ? `Saldo a favor del abono: ${formatMoney(remaining, currencyCode)}. La factura elegida tendrá ese importe menos por pagar. No se crea ningún asiento: los dos documentos ya están en la cuenta del proveedor.`
          : `Saldo a favor del abono: ${formatMoney(remaining, currencyCode)}. Se contabiliza la entrada en el banco contra la cuenta del proveedor.`}
        initialFocusId="supplier-credit-amount"
        onClose={() => setMode(null)}
        open={mode !== null}
        title={mode === "apply" ? "Compensar abono con una factura" : "Cobro de la devolución del proveedor"}
      >
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode === "apply" ? (
            <AccessibleField id="supplier-credit-invoice" label="Factura pendiente del proveedor" required>
              <Select
                id="supplier-credit-invoice"
                onChange={(event) => {
                  setInvoiceId(event.target.value);
                  const next = invoices.find((invoice) => invoice.id === event.target.value);
                  setAmount(Math.min(remaining, next?.outstanding ?? 0).toFixed(2).replace(".", ","));
                }}
                value={invoiceId}
              >
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>{invoice.label} · pendiente {formatMoney(invoice.outstanding, currencyCode)}</option>
                ))}
              </Select>
            </AccessibleField>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <AccessibleField id="supplier-credit-bank" label="Cuenta bancaria" required>
                <Select id="supplier-credit-bank" onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}>
                  {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
                </Select>
              </AccessibleField>
              <AccessibleField id="supplier-credit-date" label="Fecha del cobro" required>
                <Input id="supplier-credit-date" onChange={(event) => setPostedAt(event.target.value)} type="date" value={postedAt} />
              </AccessibleField>
            </div>
          )}
          <AccessibleField helperText={`Máximo: ${formatMoney(maxAmount, currencyCode)}.`} id="supplier-credit-amount" label="Importe" required>
            <MoneyInput id="supplier-credit-amount" onChange={(event) => setAmount(event.target.value)} value={amount} />
          </AccessibleField>
          {mode === "refund" ? (
            <AccessibleField id="supplier-credit-reference" label="Referencia">
              <Input id="supplier-credit-reference" onChange={(event) => setReference(event.target.value)} placeholder="Concepto de la transferencia (opcional)" value={reference} />
            </AccessibleField>
          ) : null}
          <FormErrorMessage>{formError}</FormErrorMessage>
          <DialogFooter>
            <Button onClick={() => setMode(null)} type="button" variant="outline">Cancelar</Button>
            <SubmitButton pending={pending} pendingLabel="Guardando…">{mode === "apply" ? "Compensar" : "Registrar cobro"}</SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
