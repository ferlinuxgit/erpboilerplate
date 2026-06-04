"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { invoicePaymentStatusLabels, statusLabel } from "@/lib/status-labels";

type CustomerCashActionsProps = {
  invoice: {
    id: string;
    number: string;
    customerName: string;
    totalAmount: number;
    totalAmountLabel: string;
    paymentStatus: string;
  };
  paymentMethods: Array<{ id: string; name: string }>;
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function CustomerCashActions({ invoice, paymentMethods }: CustomerCashActionsProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(invoice.totalAmount.toString());
  const [postedAt, setPostedAt] = useState(todayInputValue());
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
          paymentMethodId,
        }),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;

      if (!response.ok) {
        setError(payload?.message ?? "No se pudo registrar el cobro.");
        return;
      }

      router.refresh();
    } catch {
      setError("No se pudo registrar el cobro.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-3" data-testid={`customer-cash-invoice-${invoice.id}`}>
      <div>
        <p className="font-medium">Factura {invoice.number}</p>
        <p className="text-sm text-muted-foreground">{invoice.customerName} · {invoice.totalAmountLabel}</p>
        <p className="text-sm">Estado de cobro: {statusLabel(invoicePaymentStatusLabels, invoice.paymentStatus)}</p>
      </div>
      <form className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end" onSubmit={handleSubmit}>
        <div>
          <label className="text-sm font-medium" htmlFor="customer-cash-date">
            Fecha de cobro
          </label>
          <Input id="customer-cash-date" required type="date" value={postedAt} onChange={(event) => setPostedAt(event.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="customer-cash-payment-method">
            Forma de pago
          </label>
          <Select
            disabled={!hasPaymentMethods}
            id="customer-cash-payment-method"
            required
            value={paymentMethodId}
            onChange={(event) => setPaymentMethodId(event.target.value)}
          >
            {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="customer-cash-amount">
            Importe cobrado
          </label>
          <Input
            id="customer-cash-amount"
            inputMode="decimal"
            min="0"
            step="0.01"
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <Button disabled={isSubmitting || invoice.paymentStatus === "PAID" || !hasPaymentMethods} type="submit">
          Registrar cobro
        </Button>
        {!hasPaymentMethods ? (
          <p className="text-sm text-muted-foreground md:col-span-4">
            Crea una forma de pago en Configuración &gt; Maestros antes de registrar el cobro.
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-red-600 md:col-span-4" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
