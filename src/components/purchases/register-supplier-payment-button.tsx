"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";

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
  const [postedAt, setPostedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [pending, setPending] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<Array<{ id: string; name: string }>>([]);
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; bankName: string; iban: string }>>([]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([fetch("/api/payment-methods"), fetch("/api/bank-accounts")]).then(async ([methodsResponse, accountsResponse]) => {
      if (methodsResponse.ok) setPaymentMethods(await methodsResponse.json());
      if (accountsResponse.ok) setBankAccounts(await accountsResponse.json());
    });
  }, [open]);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size={compact ? "sm" : "default"}
        type="button"
      >
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
          onSubmit={async (event) => {
            event.preventDefault();
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
                  amountApplied: Number(amount),
                  postedAt: new Date(`${postedAt}T12:00:00.000Z`).toISOString(),
                  paymentMethodId,
                  bankAccountId,
                  reference,
                  notes,
                }),
              });
              const payload = (await response.json().catch(() => null)) as {
                message?: string;
              } | null;
              if (!response.ok)
                throw new Error(
                  payload?.message ?? "No se pudo registrar el pago.",
                );
              toast.success("Pago registrado.");
              setOpen(false);
              router.refresh();
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "No se pudo registrar el pago.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`supplier-payment-amount-${contextId}`}>
              Importe
            </Label>
            <Input
              id={`supplier-payment-amount-${contextId}`}
              max={appliesToInvoice ? outstandingAmount : undefined}
              min="0.01"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.01"
              type="number"
              value={amount}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor={`supplier-payment-method-${contextId}`}>Método de pago</Label><Select id={`supplier-payment-method-${contextId}`} onChange={(event) => setPaymentMethodId(event.target.value)} value={paymentMethodId}><option value="">Sin especificar</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor={`supplier-payment-account-${contextId}`}>Cuenta bancaria</Label><Select id={`supplier-payment-account-${contextId}`} onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}><option value="">Sin especificar</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.iban}</option>)}</Select></div>
          </div>
          <div className="space-y-2"><Label htmlFor={`supplier-payment-reference-${contextId}`}>Referencia</Label><Input id={`supplier-payment-reference-${contextId}`} onChange={(event) => setReference(event.target.value)} placeholder="Referencia bancaria o concepto" value={reference} /></div>
          <div className="space-y-2"><Label htmlFor={`supplier-payment-notes-${contextId}`}>Notas</Label><Input id={`supplier-payment-notes-${contextId}`} onChange={(event) => setNotes(event.target.value)} placeholder="Información interna opcional" value={notes} /></div>
          <div className="space-y-2">
            <Label htmlFor={`supplier-payment-date-${contextId}`}>Fecha</Label>
            <Input
              id={`supplier-payment-date-${contextId}`}
              onChange={(event) => setPostedAt(event.target.value)}
              required
              type="date"
              value={postedAt}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button
              disabled={
                pending ||
                Number(amount) <= 0 ||
                (appliesToInvoice && Number(amount) > outstandingAmount)
              }
              type="submit"
            >
              {pending ? "Registrando…" : "Confirmar pago"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
