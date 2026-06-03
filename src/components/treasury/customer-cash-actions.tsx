"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
};

export function CustomerCashActions({ invoice }: CustomerCashActionsProps) {
  const router = useRouter();
  const [amount, setAmount] = useState(invoice.totalAmount.toString());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
          postedAt: new Date().toISOString(),
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
      <form className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end" onSubmit={handleSubmit}>
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
        <Button disabled={isSubmitting || invoice.paymentStatus === "PAID"} type="submit">
          Registrar cobro
        </Button>
        {error ? (
          <p className="text-sm text-red-600 md:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
