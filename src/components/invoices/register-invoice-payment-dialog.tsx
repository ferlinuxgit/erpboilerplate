"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

type PaymentMethodOption = {
  id: string;
  name: string;
};

type RegisterInvoicePaymentDialogProps = {
  invoice: {
    id: string;
    number: string;
    paymentStatus: string;
    totalAmount: number;
    totalAmountLabel: string;
  };
  paymentMethods: PaymentMethodOption[];
  triggerSize?: "default" | "sm";
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function RegisterInvoicePaymentDialog({ invoice, paymentMethods, triggerSize = "default" }: RegisterInvoicePaymentDialogProps) {
  const router = useRouter();
  const amountId = useId();
  const dateId = useId();
  const paymentMethodId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState(invoice.totalAmount.toString());
  const [postedAt, setPostedAt] = useState(todayInputValue());
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPaid = invoice.paymentStatus === "PAID";
  const hasPaymentMethods = paymentMethods.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/invoice-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amountApplied: Number(amount),
          postedAt: new Date(`${postedAt}T00:00:00.000Z`).toISOString(),
          paymentMethodId: selectedPaymentMethodId,
        }),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;

      if (!response.ok) {
        setError(payload?.message ?? "No se pudo registrar el cobro.");
        return;
      }

      setIsOpen(false);
      router.refresh();
    } catch {
      setError("No se pudo registrar el cobro.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button disabled={isPaid} onClick={() => setIsOpen(true)} size={triggerSize} type="button" variant="outline">
        Registrar cobro
      </Button>
      <Dialog initialFocusId={dateId} onClose={() => setIsOpen(false)} open={isOpen} title={`Registrar cobro ${invoice.number}`}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">{invoice.number}</p>
            <p className="text-muted-foreground">Importe factura: {invoice.totalAmountLabel}</p>
          </div>

          <AccessibleField id={dateId} label="Fecha de cobro" required>
            <Input id={dateId} required type="date" value={postedAt} onChange={(event) => setPostedAt(event.target.value)} />
          </AccessibleField>

          <AccessibleField id={paymentMethodId} label="Forma de pago" required>
            <Select
              disabled={!hasPaymentMethods}
              id={paymentMethodId}
              required
              value={selectedPaymentMethodId}
              onChange={(event) => setSelectedPaymentMethodId(event.target.value)}
            >
              {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
            </Select>
            {!hasPaymentMethods ? <p className="text-sm text-muted-foreground">Crea una forma de pago en Configuración &gt; Maestros antes de registrar el cobro.</p> : null}
          </AccessibleField>

          <AccessibleField id={amountId} label="Importe cobrado" required>
            <Input
              id={amountId}
              inputMode="decimal"
              min="0"
              required
              step="0.01"
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </AccessibleField>

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button disabled={isSubmitting} onClick={() => setIsOpen(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <Button disabled={isSubmitting || !hasPaymentMethods} type="submit">
              Registrar cobro
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
