"use client";

import { useEffect, useState } from "react";
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

type FieldErrors = Partial<Record<"amount" | "postedAt", string>>;

function currencySymbolFor(currencyCode: string) {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: currencyCode }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}

export function RegisterSupplierPaymentButton({
  compact = false,
  currencyCode = "EUR",
  invoiceId,
  outstandingAmount = 0,
  supplierId,
}: {
  compact?: boolean;
  currencyCode?: string;
  invoiceId?: string;
  outstandingAmount?: number;
  supplierId?: string;
}) {
  const contextId = invoiceId ?? supplierId ?? "supplier";
  const appliesToInvoice = Boolean(invoiceId);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(outstandingAmount > 0 ? outstandingAmount.toFixed(2) : "");
  const [postedAt, setPostedAt] = useState(new Date().toISOString().slice(0, 10));
  const [pending, setPending] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<Array<{ id: string; name: string }>>([]);
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; bankName: string; iban: string }>>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void Promise.all([fetch("/api/payment-methods"), fetch("/api/bank-accounts")])
      .then(async ([methodsResponse, accountsResponse]) => {
        if (methodsResponse.ok) setPaymentMethods(await methodsResponse.json());
        if (accountsResponse.ok) setBankAccounts(await accountsResponse.json());
      })
      .catch(() => undefined);
  }, [open]);

  function validate() {
    const nextErrors: FieldErrors = {};
    const amountApplied = parseDecimalInput(amount, { maximumFractionDigits: 2 });
    if (amountApplied === null) nextErrors.amount = "Indica el importe pagado (por ejemplo, 1.234,56).";
    else if (amountApplied <= 0) nextErrors.amount = "El importe debe ser mayor que cero.";
    else if (appliesToInvoice && amountApplied > outstandingAmount + 0.005)
      nextErrors.amount = `No puede superar el saldo pendiente (${formatMoney(outstandingAmount, currencyCode)}).`;
    if (!postedAt) nextErrors.postedAt = "Indica la fecha del pago.";
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 ? amountApplied : null;
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size={compact ? "sm" : "default"} type="button">
        Registrar pago
      </Button>
      <Dialog
        description={appliesToInvoice ? `Saldo pendiente de la factura: ${formatMoney(outstandingAmount, currencyCode)}` : `Pago a cuenta del proveedor. Saldo pendiente actual: ${formatMoney(outstandingAmount, currencyCode)}`}
        initialFocusId={`supplier-payment-amount-${contextId}`}
        onClose={() => setOpen(false)}
        open={open}
        title="Registrar pago a proveedor"
      >
        <form
          className="space-y-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setFormError(null);
            const amountApplied = validate();
            if (amountApplied === null) return;
            setPending(true);
            try {
              const response = await fetch("/api/supplier-payments", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...getCsrfHeader(),
                },
                body: JSON.stringify({
                  supplierInvoiceId: invoiceId ?? "",
                  supplierPartnerId: supplierId ?? "",
                  amountApplied,
                  postedAt: new Date(`${postedAt}T12:00:00.000Z`).toISOString(),
                  paymentMethodId,
                  bankAccountId,
                  reference,
                  notes,
                }),
              });
              if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar el pago."));
              toast.success(`Pago de ${formatMoney(amountApplied, currencyCode)} registrado.`);
              setOpen(false);
              router.refresh();
            } catch (error) {
              const message = errorMessage(error, "No se pudo registrar el pago. Inténtalo de nuevo.");
              setFormError(message);
              toast.error(message);
            } finally {
              setPending(false);
            }
          }}
        >
          <AccessibleField
            error={fieldErrors.amount}
            helperText={appliesToInvoice ? `Máximo: ${formatMoney(outstandingAmount, currencyCode)}. Puede ser un pago parcial.` : undefined}
            id={`supplier-payment-amount-${contextId}`}
            label="Importe"
            required
          >
            <MoneyInput currencySymbol={currencySymbolFor(currencyCode)} id={`supplier-payment-amount-${contextId}`} onChange={(event) => setAmount(event.target.value)} value={amount} />
          </AccessibleField>
          <div className="grid gap-4 sm:grid-cols-2">
            <AccessibleField id={`supplier-payment-method-${contextId}`} label="Método de pago">
              <Select id={`supplier-payment-method-${contextId}`} onChange={(event) => setPaymentMethodId(event.target.value)} value={paymentMethodId}>
                <option value="">Sin especificar</option>
                {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
              </Select>
            </AccessibleField>
            <AccessibleField id={`supplier-payment-account-${contextId}`} label="Cuenta bancaria">
              <Select id={`supplier-payment-account-${contextId}`} onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}>
                <option value="">Sin especificar</option>
                {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.iban}</option>)}
              </Select>
            </AccessibleField>
          </div>
          <AccessibleField id={`supplier-payment-reference-${contextId}`} label="Referencia">
            <Input id={`supplier-payment-reference-${contextId}`} onChange={(event) => setReference(event.target.value)} placeholder="Referencia bancaria o concepto" value={reference} />
          </AccessibleField>
          <AccessibleField id={`supplier-payment-notes-${contextId}`} label="Notas">
            <Input id={`supplier-payment-notes-${contextId}`} onChange={(event) => setNotes(event.target.value)} placeholder="Información interna opcional" value={notes} />
          </AccessibleField>
          <AccessibleField error={fieldErrors.postedAt} id={`supplier-payment-date-${contextId}`} label="Fecha" required>
            <Input id={`supplier-payment-date-${contextId}`} onChange={(event) => setPostedAt(event.target.value)} type="date" value={postedAt} />
          </AccessibleField>
          <FormErrorMessage>{formError}</FormErrorMessage>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <SubmitButton pending={pending} pendingLabel="Registrando…">
              Confirmar pago
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
