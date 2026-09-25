"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney, parseDecimalInput } from "@/lib/format";
import { invoicePaymentStatusLabels, statusLabel } from "@/lib/status-labels";
import { describeDueDate, todayDateInput } from "@/server/invoices/due-dates";

type PendingInvoice = {
  id: string;
  number: string;
  customerName: string;
  totalAmount: number;
  totalAmountLabel?: string;
  paymentStatus: string;
  /** Net outstanding (total − credit notes − payments); proposed as the amount. Defaults to the total. */
  outstandingAmount?: number;
  dueDate?: string | Date | null;
};

type CustomerCashActionsProps = {
  /** Factura propuesta (la siguiente pendiente). */
  invoice: PendingInvoice;
  paymentMethods: Array<{ id: string; name: string }>;
  /** Facturas pendientes entre las que elegir; si no se indican se cargan de la API. */
  invoices?: PendingInvoice[];
};

function amountInputValue(amount: number) {
  return (Math.round(amount * 100) / 100).toFixed(2).replace(".", ",");
}

function pendingAmount(invoice: PendingInvoice) {
  return Math.max(invoice.outstandingAmount ?? invoice.totalAmount, 0);
}

function optionLabel(invoice: PendingInvoice) {
  const due = invoice.dueDate ? describeDueDate(invoice.dueDate) : null;
  return `${invoice.number} · ${invoice.customerName} · pendiente ${formatMoney(pendingAmount(invoice))}${due ? ` · ${due.label.toLocaleLowerCase("es-ES")}` : ""}`;
}

/**
 * Registrar un cobro desde Tesorería: se elige la factura pendiente (por defecto la propuesta),
 * la fecha (hoy en España), la forma de pago y el importe (el pendiente, editable).
 */
export function CustomerCashActions({ invoice, invoices, paymentMethods }: CustomerCashActionsProps) {
  const router = useRouter();
  const baseId = useId();
  const ids = {
    invoice: `${baseId}-invoice`,
    date: `${baseId}-date`,
    method: `${baseId}-method`,
    amount: `${baseId}-amount`,
  };
  const [options, setOptions] = useState<PendingInvoice[]>(invoices ?? [invoice]);
  const [selectedId, setSelectedId] = useState(invoice.id);
  const selected = useMemo(() => options.find((option) => option.id === selectedId) ?? invoice, [invoice, options, selectedId]);
  const [amount, setAmount] = useState(amountInputValue(pendingAmount(invoice)));
  const [postedAt, setPostedAt] = useState(() => todayDateInput());
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasPaymentMethods = paymentMethods.length > 0;

  // Carga el resto de facturas pendientes para poder elegir otra distinta de la propuesta.
  useEffect(() => {
    if (invoices) return;
    let cancelled = false;
    fetch("/api/invoices?pending=1", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: Array<PendingInvoice & { totalAmount: string | number; outstandingAmount: number }> } | null) => {
        if (cancelled || !payload?.data?.length) return;
        const loaded = payload.data.map((row) => ({ ...row, totalAmount: Number(row.totalAmount), outstandingAmount: Number(row.outstandingAmount) }));
        setOptions(loaded.some((row) => row.id === invoice.id) ? loaded : [invoice, ...loaded]);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [invoice, invoices]);

  function selectInvoice(id: string) {
    setSelectedId(id);
    const next = options.find((option) => option.id === id);
    if (next) setAmount(amountInputValue(pendingAmount(next)));
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const amountApplied = parseDecimalInput(amount, { maximumFractionDigits: 2 });
    if (amountApplied === null || amountApplied <= 0) {
      setError("Indica el importe cobrado (por ejemplo, 1.234,56).");
      return;
    }
    if (!postedAt) {
      setError("Indica la fecha de cobro.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/invoice-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          invoiceId: selected.id,
          amountApplied,
          postedAt: new Date(`${postedAt}T00:00:00.000Z`).toISOString(),
          paymentMethodId,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar el cobro."));
      toast.success(`Cobro de ${formatMoney(amountApplied)} registrado en la factura ${selected.number}.`);
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudo registrar el cobro.");
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-3 rounded-[2px] border border-window-dark-shadow p-3" data-testid={`customer-cash-invoice-${invoice.id}`}>
      <form className="grid gap-3 md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end" noValidate onSubmit={handleSubmit}>
        <AccessibleField helperText={options.length > 1 ? `${options.length} facturas pendientes; se propone la más urgente.` : undefined} id={ids.invoice} label="Factura que se cobra" required>
          <Select data-testid="customer-cash-invoice-select" value={selected.id} onChange={(event) => selectInvoice(event.target.value)}>
            {options.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField id={ids.date} label="Fecha de cobro" required>
          <Input required type="date" value={postedAt} onChange={(event) => setPostedAt(event.target.value)} />
        </AccessibleField>
        <AccessibleField
          helperText={hasPaymentMethods ? undefined : "Crea una forma de pago en Configuración › Maestros antes de registrar el cobro."}
          id={ids.method}
          label="Forma de pago"
          required
        >
          <Select disabled={!hasPaymentMethods} required value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
            {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField id={ids.amount} label="Importe cobrado" required>
          <MoneyInput value={amount} onChange={(event) => setAmount(event.target.value)} />
        </AccessibleField>
        <SubmitButton disabled={selected.paymentStatus === "PAID" || !hasPaymentMethods} pending={isSubmitting} pendingLabel="Registrando…">
          Registrar cobro
        </SubmitButton>
        <p className="text-xs text-muted-foreground md:col-span-2 lg:col-span-5">
          {selected.customerName} · Factura {selected.number}
          {selected.totalAmountLabel ? ` · Total ${selected.totalAmountLabel}` : ` · Total ${formatMoney(selected.totalAmount)}`}
          {` · Estado: ${statusLabel(invoicePaymentStatusLabels, selected.paymentStatus)}`}
          {selected.dueDate ? ` · Vence el ${formatDate(selected.dueDate)}` : ""}
        </p>
        <FormErrorMessage className="md:col-span-2 lg:col-span-5">{error}</FormErrorMessage>
      </form>
    </section>
  );
}
