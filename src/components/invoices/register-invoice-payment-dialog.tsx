"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";

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
    /** Saldo pendiente (total − rectificativas − cobros). Si no se indica se usa el total. */
    outstandingAmount?: number;
  };
  paymentMethods: PaymentMethodOption[];
  triggerSize?: "default" | "sm";
};

type FieldErrors = Partial<Record<"postedAt" | "paymentMethod" | "amount", string>>;

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

/** Importe con coma decimal, como lo escribe el usuario en es-ES ("1234,56"). */
function amountInputValue(amount: number) {
  return (Math.round(amount * 100) / 100).toFixed(2).replace(".", ",");
}

export function RegisterInvoicePaymentDialog({ invoice, paymentMethods, triggerSize = "default" }: RegisterInvoicePaymentDialogProps) {
  const router = useRouter();
  const amountId = useId();
  const dateId = useId();
  const paymentMethodId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const outstandingAmount = Math.max(invoice.outstandingAmount ?? invoice.totalAmount, 0);
  const [amount, setAmount] = useState(amountInputValue(outstandingAmount));
  const [postedAt, setPostedAt] = useState(todayInputValue());
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPaid = invoice.paymentStatus === "PAID" || invoice.paymentStatus === "VOID" || outstandingAmount <= 0;

  function openDialog() {
    // Cada vez que se abre se propone el saldo pendiente actual (lo habitual es cobrarlo entero).
    setAmount(amountInputValue(outstandingAmount));
    setFieldErrors({});
    setError(null);
    setIsOpen(true);
  }
  const hasPaymentMethods = paymentMethods.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const amountApplied = parseDecimalInput(amount, { maximumFractionDigits: 2 });
    const nextFieldErrors: FieldErrors = {};
    if (!postedAt) nextFieldErrors.postedAt = "Indica la fecha de cobro.";
    if (!selectedPaymentMethodId) nextFieldErrors.paymentMethod = "Selecciona la forma de pago.";
    if (amountApplied === null) nextFieldErrors.amount = "Indica el importe cobrado (por ejemplo, 1.234,56).";
    setFieldErrors(nextFieldErrors);
    if (amountApplied === null || Object.keys(nextFieldErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/invoice-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amountApplied,
          postedAt: new Date(`${postedAt}T00:00:00.000Z`).toISOString(),
          paymentMethodId: selectedPaymentMethodId,
        }),
      });

      if (!response.ok) {
        const message = await readApiError(response, "No se pudo registrar el cobro.");
        setError(message);
        toast.error(message);
        return;
      }

      setIsOpen(false);
      toast.success(`Cobro registrado en la factura ${invoice.number}.`);
      router.refresh();
    } catch (submissionError) {
      const message = errorMessage(submissionError, "No se pudo registrar el cobro. Inténtalo de nuevo.");
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button disabled={isPaid} onClick={openDialog} size={triggerSize} type="button" variant="outline">
        Registrar cobro
      </Button>
      <Dialog description="Informa la fecha, la forma de pago y el importe recibido." initialFocusId={dateId} onClose={() => setIsOpen(false)} open={isOpen} title={`Registrar cobro ${invoice.number}`}>
        <form className="space-y-4" noValidate onSubmit={handleSubmit}>
          <div className="rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-xs">
            <p className="font-mono font-bold">{invoice.number}</p>
            <p className="text-muted-foreground">Importe factura: <span className="font-mono tabular-nums">{invoice.totalAmountLabel}</span></p>
            <p className="text-muted-foreground" data-testid="payment-dialog-outstanding">
              Pendiente de cobro: <span className="font-mono font-bold tabular-nums">{formatMoney(outstandingAmount)}</span>
            </p>
          </div>

          <AccessibleField error={fieldErrors.postedAt} id={dateId} label="Fecha de cobro" required>
            <Input id={dateId} type="date" value={postedAt} onChange={(event) => setPostedAt(event.target.value)} />
          </AccessibleField>

          <AccessibleField
            error={fieldErrors.paymentMethod}
            helperText={hasPaymentMethods ? undefined : "Crea una forma de pago en Configuración > Maestros antes de registrar el cobro."}
            id={paymentMethodId}
            label="Forma de pago"
            required
          >
            <Select
              disabled={!hasPaymentMethods}
              id={paymentMethodId}
              value={selectedPaymentMethodId}
              onChange={(event) => setSelectedPaymentMethodId(event.target.value)}
            >
              {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
            </Select>
          </AccessibleField>

          <AccessibleField error={fieldErrors.amount} helperText="Propuesto: el saldo pendiente. Puedes cambiarlo para un cobro parcial." id={amountId} label="Importe cobrado" required>
            <MoneyInput id={amountId} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </AccessibleField>

          <FormErrorMessage>{error}</FormErrorMessage>

          <DialogFooter>
            <Button disabled={isSubmitting} onClick={() => setIsOpen(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <SubmitButton disabled={!hasPaymentMethods} pending={isSubmitting} pendingLabel="Registrando…">
              Registrar cobro
            </SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
